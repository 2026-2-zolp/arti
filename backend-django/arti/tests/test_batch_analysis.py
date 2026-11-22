from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from arti import batch_analysis, emotion_jobs
from arti.http import ContractError
from arti.models import Artwork, ArtworkAnalysisBatch, ArtworkAnalysisItem
from arti.tests.test_integration import Helpers
from arti.tests.test_model_service import result


def proposal(kind, work, **options):
    return {
        'summary': {'summary': '합성 요약 제안', 'keywords': []},
        'guide': {'intro': '합성 관람 가이드', 'questions': ['어디가 밝나요?'], 'hints': ['가운데를 보세요.']},
        'tag': {'scores': result()['tags']},
        'emotion': result(),
    }[kind]


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_BACKGROUND_BATCH_ANALYSIS=True,
                   ARTI_BACKGROUND_EMOTION=False, ARTI_DRAFT_GUIDE_REVIEW=False)
class ArtworkBatchTests(Helpers, TestCase):
    path = '/api/admin/analysis-batches'
    exhibition = 'fixture-ex01'
    first = 'fixture-art01'
    second = 'fixture-art02'

    def setUp(self):
        self.setup_clients()
        Artwork.objects.filter(exhibition_id=self.exhibition).exclude(
            pk__in=(self.first, self.second),
        ).update(review_status='pending')
        Artwork.objects.filter(pk__in=(self.first, self.second)).update(
            review_status='approved', summary='기존에 확정한 합성 요약', summary_status='confirmed',
            guide_status='none', tag_status='none', emotion_status='none',
        )

    def enroll(self):
        return self.admin.post(self.path, {'exhibitionId': self.exhibition, 'useImage': False}, format='json')

    def states(self):
        return self.admin.get(self.path).json()['batches'][0]['items']

    def retry(self, artwork_id):
        batch = ArtworkAnalysisBatch.objects.get()
        return self.admin.post(f'{self.path}/{batch.pk}/retry', {'artworkId': artwork_id}, format='json')

    def test_first_review_and_retry_failed_fields_only(self):
        self.assertEqual(self.public.get(self.path).status_code, 401)
        self.assertEqual(self.a.post(self.path, {'exhibitionId': self.exhibition}, format='json').status_code, 401)
        with self.settings(ARTI_BACKGROUND_BATCH_ANALYSIS=False):
            self.assertEqual(self.admin.get(self.path).json(), {'enabled': False, 'batches': []})
            self.assertEqual(self.enroll().status_code, 503)
        initial = self.enroll()
        self.assertEqual(initial.status_code, 202)
        self.assertEqual(self.enroll().json(), initial.json())
        self.assertEqual(ArtworkAnalysisBatch.objects.count(), 1)
        self.assertEqual([item['state'] for item in self.states()], ['queued', 'queued'])
        calls = []

        def fail_guide(kind, work, **options):
            calls.append((work['id'], kind))
            if work['id'] == self.second and kind == 'guide':
                raise ContractError(502, 'PROVIDER_ERROR', '모의 가이드 실패')
            return proposal(kind, work, **options)

        with patch('arti.providers.generate', side_effect=fail_guide):
            self.assertTrue(batch_analysis.process_next())
            first, second = self.states()
            self.assertEqual((first['state'], first['reviewReady'], second['state']), ('completed', True, 'queued'))
            first_version = Artwork.objects.get(pk=self.first).version
            self.assertTrue(batch_analysis.process_next())
        self.assertEqual(self.states()[1]['failures'], {'guide': 'PROVIDER_ERROR'})
        self.assertTrue(self.states()[1]['reviewReady'])
        self.assertNotIn('summary', {kind for _, kind in calls})
        self.assertEqual(self.retry(self.first).status_code, 202)
        self.assertFalse(batch_analysis.process_next())
        self.assertEqual(self.retry(self.second).status_code, 202)
        self.assertEqual([item['state'] for item in self.states()], ['completed', 'queued'])
        with patch('arti.providers.generate', side_effect=proposal) as retried:
            self.assertTrue(batch_analysis.process_next())
            self.assertEqual([(call.args[1]['id'], call.args[0]) for call in retried.call_args_list],
                             [(self.second, 'guide')])
        self.assertEqual([item['state'] for item in self.states()], ['completed', 'completed'])
        self.assertEqual(Artwork.objects.get(pk=self.first).version, first_version)
        for artwork in Artwork.objects.filter(pk__in=(self.first, self.second)):
            public = self.public.get(f'/api/artworks/{artwork.pk}').json()
            self.assertEqual((public['summary'], public['summaryStatus']), ('기존에 확정한 합성 요약', 'confirmed'))

    def test_only_missing_guide_is_generated_when_other_outputs_are_confirmed(self):
        Artwork.objects.filter(pk__in=(self.first, self.second)).update(
            tag_status='confirmed', tag_scores=result()['tags'], tag_score_evidence=None,
            emotion_status='confirmed', analysis=result(),
        )
        Artwork.objects.filter(pk=self.second).update(guide_status='confirmed', guide_intro='확정 가이드')
        before = self.public.get(f'/api/artworks/{self.first}').json()
        second = Artwork.objects.get(pk=self.second)
        self.assertEqual(self.enroll().status_code, 202)
        self.assertEqual([item['artworkId'] for item in self.states()], [self.first])
        with patch('arti.providers.generate', side_effect=proposal) as generated:
            self.assertTrue(batch_analysis.process_next())
            self.assertEqual([call.args[0] for call in generated.call_args_list], ['guide'])
        after = self.public.get(f'/api/artworks/{self.first}').json()
        for field in ('summary', 'summaryStatus', 'tagScores', 'tagStatus', 'analysis', 'emotionStatus'):
            self.assertEqual(before[field], after[field], field)
        self.assertEqual(Artwork.objects.get(pk=self.second).version, second.version)
        self.assertEqual(after['guideStatus'], 'none')

    @override_settings(ARTI_BACKGROUND_EMOTION=True, ARTI_MODEL_SERVICE_URL='http://127.0.0.1:8')
    def test_proposals_available_while_emotion_waits_and_emotion_retry_is_isolated(self):
        Artwork.objects.filter(pk=self.second).update(review_status='pending')
        self.assertEqual(self.enroll().status_code, 202)
        with patch('arti.providers.generate', side_effect=proposal):
            self.assertTrue(batch_analysis.process_next())
        item = self.states()[0]
        self.assertEqual((item['state'], item['reviewReady']), ('emotion', True))
        with patch('arti.model_service.analyze', side_effect=ContractError(504, 'AI_TIMEOUT', '모의 시간 초과')):
            self.assertTrue(emotion_jobs.process_next())
        self.assertTrue(batch_analysis.process_next())
        self.assertEqual(self.states()[0]['failures'], {'emotion': 'AI_TIMEOUT'})
        self.assertEqual(self.retry(self.first).status_code, 202)
        with patch('arti.providers.generate') as other_fields:
            self.assertTrue(batch_analysis.process_next())
            other_fields.assert_not_called()
        with patch('arti.model_service.analyze', return_value=result()):
            self.assertTrue(emotion_jobs.process_next())
        self.assertTrue(batch_analysis.process_next())
        self.assertEqual(self.states()[0]['state'], 'completed')

    def test_input_changed_and_expired_worker_cannot_store_a_late_proposal(self):
        self.assertEqual(self.enroll().status_code, 202)
        work = Artwork.objects.get(pk=self.first)
        self.assertEqual(self.put(work, description=work.description + ' 수정').status_code, 200)
        self.assertTrue(batch_analysis.process_next())
        self.assertEqual(self.states()[0]['failures'], {'analysis': 'VERSION_CONFLICT'})

        def lose_lease(kind, artwork, **options):
            ArtworkAnalysisItem.objects.filter(artwork_id=self.second).update(
                claim_id=uuid4(), due_at=timezone.now() - timedelta(seconds=1),
            )
            return proposal(kind, artwork, **options)

        before = Artwork.objects.get(pk=self.second).version
        with patch('arti.providers.generate', side_effect=lose_lease):
            self.assertTrue(batch_analysis.process_next())
        self.assertEqual(Artwork.objects.get(pk=self.second).version, before)
        with patch('arti.providers.generate', side_effect=proposal):
            self.assertTrue(batch_analysis.process_next())
        self.assertEqual(self.states()[1]['state'], 'completed')
