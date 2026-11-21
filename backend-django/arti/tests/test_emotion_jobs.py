import json
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone

from arti import emotion_jobs, providers
from arti.http import ContractError
from arti.models import Artwork, EmotionJob
from arti.tests.test_integration import Helpers
from arti.tests.test_model_service import result
from arti.tests.test_provider import endpoint


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_BACKGROUND_EMOTION=True,
                   ARTI_MODEL_SERVICE_URL='http://localhost:8001', ARTI_DRAFT_GUIDE_REVIEW=False)
class EmotionJobTests(Helpers, TestCase):
    work_id = 'fixture-art01'

    def setUp(self):
        self.setup_clients()
        self.path = f'/api/admin/artworks/{self.work_id}'

    def submit(self, fields=('emotion',), use_image=True):
        version = Artwork.objects.get(pk=self.work_id).version
        response = self.admin.post(self.path + '/analyze', {
            'version': version, 'useImage': use_image, 'regenerateFields': list(fields),
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def status(self):
        return self.admin.get(self.path + '/emotion-job').json()['job']

    def test_foreground_proposals_are_saved_and_same_input_reuses_the_completed_job(self):
        self.assertIn(self.public.get(self.path + '/emotion-job').status_code, (401, 403))
        packet = result()
        generate = providers.generate

        def drafts(kind, snapshot, **context):
            if kind == 'summary':
                return {'summary': '새 요약 제안', 'keywords': []}
            if kind == 'guide':
                return {'intro': '새 가이드 도입', 'questions': ['어느 색이 먼저 보이나요?'], 'hints': ['가운데를 보세요.']}
            return generate(kind, snapshot, **context)

        with endpoint(body=json.dumps(packet).encode()) as calls, patch('arti.providers.generate', side_effect=drafts):
            with self.settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                initial = self.submit(('summary', 'guide', 'tag', 'emotion'))
                early = Artwork.objects.get(pk=self.work_id)
                self.assertEqual((early.summary, early.summary_status), ('새 요약 제안', 'suggested'))
                self.assertEqual((early.guide_intro, early.tag_score_source, early.tag_status),
                                 ('새 가이드 도입', 'image', 'suggested'))
                self.assertEqual([call['path'] for call in calls], ['/analyze-tags'])
                self.assertEqual(initial['emotionJob']['state'], 'queued')
                self.assertEqual(self.submit()['emotionJob']['id'], initial['emotionJob']['id'])
                self.assertTrue(emotion_jobs.process_next())
                complete = self.status()
                self.assertEqual(complete['previousVersion'], early.version)
                self.assertEqual(complete['completed']['emotionStatus'], 'suggested')
                self.assertEqual(complete['completed']['analysis']['emotions'], packet['emotions'])
                again = self.submit()['emotionJob']
                self.assertEqual((again['id'], again['state']), (complete['id'], 'ready'))
                self.assertFalse(emotion_jobs.process_next())
                self.assertEqual([call['path'] for call in calls], ['/analyze-tags', '/analyze-emotion'])
                self.assertEqual(Artwork.objects.get(pk=self.work_id).version, complete['resultVersion'])

    def test_changed_source_and_replaced_image_reject_in_flight_results(self):
        for change in ('source', 'image'):
            with self.subTest(change=change):
                job = self.submit()['emotionJob']
                work = Artwork.objects.get(pk=self.work_id)

                def change_during_call(*args, **kwargs):
                    if change == 'source':
                        response = self.put(work, description=work.description + ' 변경')
                    else:
                        response = self.admin.post(self.path + '/image', b'\x89PNG\r\n\x1a\nnext image',
                                                   content_type='image/png', HTTP_IF_MATCH=f'"{work.version}"')
                    self.assertEqual(response.status_code, 200, response.content)
                    return result()

                with patch('arti.model_service.analyze', side_effect=change_during_call):
                    self.assertTrue(emotion_jobs.process_next())
                work.refresh_from_db()
                self.assertEqual(work.review_status, 'source_check')
                self.assertEqual(self.status()['id'], job['id'])
                self.assertEqual(self.status()['state'], 'stale')
                self.assertIsNone(EmotionJob.objects.get(pk=work.pk).result_version)
                self.assertEqual(self.put(work, reviewStatus='approved').status_code, 200)

    def test_failed_job_can_retry_and_expired_lease_cannot_publish(self):
        original = self.submit()['emotionJob']
        with patch('arti.model_service.analyze', side_effect=ContractError(504, 'AI_TIMEOUT', 'timeout')):
            self.assertTrue(emotion_jobs.process_next())
        self.assertEqual(self.status()['state'], 'failed')
        restarted = self.submit()['emotionJob']
        self.assertNotEqual(restarted['id'], original['id'])
        old_claim = emotion_jobs.claim()
        EmotionJob.objects.filter(pk=self.work_id).update(due_at=timezone.now() - timedelta(seconds=1))
        new_claim = emotion_jobs.claim()
        emotion_jobs.complete(old_claim, result())
        self.assertEqual(self.status()['state'], 'running')
        emotion_jobs.complete(new_claim, result())
        self.assertEqual(self.status()['state'], 'ready')

    def test_tag_request_without_image_and_recognized_job_revision(self):
        with endpoint(body=json.dumps(result() | {'usedImage': False, 'tagSource': 'text'}).encode()) as calls:
            with self.settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                queued = self.submit(('tag', 'emotion'), False)['emotionJob']
                self.assertEqual(calls[0]['path'], '/analyze-tags')
                self.assertNotIn('imageBase64', calls[0]['body'])
                with self.settings(ARTI_ANALYSIS_REVISION='changed-calibration'):
                    newer = self.submit(use_image=False)['emotionJob']
                    self.assertNotEqual(queued['id'], newer['id'])
                    self.assertTrue(emotion_jobs.process_next())
                self.assertEqual(calls[1]['path'], '/analyze-emotion')
                self.assertNotIn('imageBase64', calls[1]['body'])
