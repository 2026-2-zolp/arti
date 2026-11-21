import io
import json
import os
from collections import Counter
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti import providers
from arti.member import issue
from arti.models import Account, Artwork, Visit
from arti.tests.docent_browser_server import ensure_visitor_memory_fixture
from arti.tests.test_docent_tools import model_answer
from arti.tests.test_provider import endpoint

PROTOCOL = Path(__file__).resolve().parents[3] / 'docs/review/docent-2026-11-15/visitor-memory-protocol.json'


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_DOCENT_MEMORY_DEMO=True,
                   ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-memory',
                   OPENAI_MODEL='synthetic-memory', ARTI_LLM_MODELS={})
class VisitorMemoryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('load_test_fixture', stdout=io.StringIO())
        ensure_visitor_memory_fixture()
        cls.prior = Artwork.objects.get(pk='fixture-art03')
        cls.current = Artwork.objects.get(pk='fixture-art01')
        cls.next_exhibition_work = 'fixture-memory-art01'
        cls.owner = Account.objects.create(role='user', email='memory-owner@example.test', login_id='memory-owner@example.test')
        cls.other = Account.objects.create(role='user', email='memory-other@example.test', login_id='memory-other@example.test')

    def setUp(self):
        cache.clear()
        self.client = APIClient(HTTP_HOST='localhost')
        self.owner_id = None
        self.visit_id = str(uuid4())
        self.visit_date = timezone.now().isoformat()
        self.interest = {'artworkId': self.prior.id, 'contentVersion': self.prior.content_version,
                         'topics': ['light', 'color', 'secret-raw-text'], 'style': 'simple',
                         'rawQuestion': 'secret-raw-text'}

    def identify(self, account):
        token = issue(account).data['token']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.owner_id = account.id

    def ask(self, work_id=None, earlier=None, preferred=None, question='어디를 먼저 보면 좋나요?'):
        return self.client.post(f'/api/artworks/{work_id or self.current.id}/ask', {
            'visitId': self.visit_id, 'question': question,
            'visitorMemory': {'ownerId': self.owner_id, 'earlier': earlier or [], 'preferredTags': preferred or []},
        }, format='json')

    def prompt(self, calls):
        return json.loads(calls[-1]['body']['messages'][1]['content'])

    def receipt(self, **changes):
        return self.client.post('/api/visits', {
            'visitId': self.visit_id, 'exhibitionId': self.prior.exhibition_id,
            'date': self.visit_date, 'durationMin': 15, 'selectedDuration': None,
            'visitMode': 'exhibition_order', 'recommendedCount': 3, 'requestGeneration': 1,
            'viewedArtworkIds': [self.prior.id], 'reactions': {self.prior.id: 'like'},
            'docentInterests': [self.interest, {**self.interest, 'artworkId': self.current.id}],
            **changes,
        }, format='json')

    def test_compaction_and_current_work_evidence(self):
        answer = model_answer('합성 응답', sourceRefs=[{'artworkId': self.prior.id, 'kind': 'original'}])
        Artwork.objects.filter(pk=self.current.id).update(tags=['warm'])
        with endpoint(body=answer) as calls:
            first = self.ask(work_id=self.prior.id, question='빛과 색감을 쉽게 설명해 주세요.')
            self.assertEqual(first.json()['interestSignal'], {'topics': ['light', 'color'], 'style': 'simple'})
            result = self.ask(earlier=[self.interest], preferred=['cool', 'warm', 'secret-raw-text'])
            self.assertEqual(result.status_code, 200, result.content)
            self.assertEqual(self.prompt(calls)['visitorContext'], {
                'earlierInExhibition': [{'artwork': self.prior.title, 'topics': ['빛과 명암', '색감'], 'style': '쉬운 설명'}],
                'matchingTasteTags': ['따뜻한 색감'],
            })
            self.assertNotIn('secret-raw-text', str(self.prompt(calls)))
            self.assertEqual({ref['artworkId'] for ref in result.json()['sourceRefs']}, {self.current.id})
            self.assertEqual(len(calls), 2)

            Artwork.objects.filter(pk=self.prior.id).update(content_version=self.prior.content_version + 1)
            self.assertEqual(self.ask(earlier=[self.interest]).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))
            self.assertEqual(self.ask(self.next_exhibition_work, earlier=[self.interest]).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))

    @override_settings(ARTI_DOCENT_MEMORY_DEMO=False, ARTI_DOCENT_VISIT_CONTEXT_EXHIBITIONS={'fixture-ex01'})
    def test_same_visit_only_can_be_enabled_without_receipt_memory(self):
        with endpoint(body=model_answer('합성 확인')) as calls:
            self.identify(self.owner)
            work = self.client.get(f'/api/artworks/{self.current.id}?docent=true').json()
            self.assertTrue(work['visitorMemoryEnabled'])
            self.assertFalse(work['visitRecapEnabled'])
            self.assertEqual(self.ask(earlier=[self.interest]).status_code, 200)
            self.assertIn('earlierInExhibition', self.prompt(calls)['visitorContext'])
            self.assertNotIn('secret-raw-text', str(self.prompt(calls)))
            self.assertEqual(self.ask(earlier=[self.interest], question='제작 시기는 언제인가요?').status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))
            saved = self.receipt()
            self.assertEqual(saved.status_code, 201)
            self.assertEqual(Visit.objects.get(pk=saved.json()['id']).docent_memory, {})
            self.assertEqual(self.ask(self.next_exhibition_work).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))

    def test_member_recap_following_exhibition_retry_and_ownership(self):
        answer = model_answer('합성 응답')
        url = f'/api/artworks/{self.prior.id}/liked-recap'
        with endpoint(body=answer) as calls:
            self.assertEqual(self.receipt().status_code, 200)
            self.assertEqual(Visit.objects.count(), 0)
            self.assertEqual(self.client.get(url).status_code, 401)
            self.identify(self.owner)
            saved = self.receipt()
            self.assertEqual(saved.status_code, 201, saved.content)
            self.assertNotIn('docentInterests', saved.json())
            visit = Visit.objects.get(user=self.owner)
            self.assertNotIn('secret-raw-text', str(visit.docent_memory))
            self.assertEqual(list(visit.docent_memory['works']), [self.prior.id])
            replay = self.receipt(docentInterests=[])
            self.assertEqual(replay.json()['id'], saved.json()['id'])
            self.assertEqual(Visit.objects.filter(user=self.owner).count(), 1)
            recap = self.client.get(url)
            self.assertEqual(recap.status_code, 200)
            self.assertEqual(recap.json()['recap']['topics'], ['빛과 명암', '색감'])
            self.assertEqual(recap.headers['Cache-Control'], 'private, no-store')
            self.assertEqual(self.ask().status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))
            self.assertEqual(self.ask(self.next_exhibition_work).status_code, 200)
            self.assertEqual(self.prompt(calls)['visitorContext'], {'previousVisit': {
                'topics': ['빛과 명암', '색감'], 'style': '쉬운 설명', 'tags': ['풍경'],
                'viewedCount': 1, 'durationMin': 15, 'mode': 'exhibition_order',
            }})
            self.identify(self.other)
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(self.ask(self.next_exhibition_work).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))
            self.owner_id = self.owner.id
            self.assertEqual(self.ask(earlier=[self.interest]).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))
            self.identify(self.owner)
            Artwork.objects.filter(pk=self.prior.id).update(review_status='pending')
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_feature_gate_and_late_prior_revision(self):
        path = f'/api/artworks/{self.current.id}?docent=true'
        with endpoint(), override_settings(ARTI_DOCENT_MEMORY_DEMO=False):
            self.assertNotIn('visitorMemoryEnabled', self.client.get(path).json())
            reply = self.ask(earlier=[self.interest], question='빛을 쉽게 설명해 주세요.')
            self.assertNotIn('interestSignal', reply.json())

        def generate(*args, **kwargs):
            Artwork.objects.filter(pk=self.prior.id).update(content_version=self.prior.content_version + 1)
            return {'answer': '이전 버전이 포함된 합성 답변'}

        with endpoint(), patch('arti.docent.providers.generate', side_effect=generate):
            self.assertIs(self.client.get(path).json()['visitorMemoryEnabled'], True)
            result = self.ask(earlier=[self.interest])
            self.assertEqual(result.status_code, 409, result.content)
            self.assertEqual(result.json()['code'], 'VISIT_CONTEXT_CHANGED')
            self.assertNotIn('answer', result.json())

    def change_memory(self, **change):
        return self.client.patch(f'/api/users/{self.owner.pk}/docent-memory', change, format='json')

    def test_member_can_disable_and_reset_cross_visit_memory_without_removing_receipt_or_liked_recap(self):
        url = f'/api/users/{self.owner.pk}/docent-memory'
        recap = f'/api/artworks/{self.prior.pk}/liked-recap'
        with endpoint(body=model_answer('합성 응답')) as calls:
            self.assertEqual(self.client.get(url).status_code, 401)
            self.identify(self.other)
            self.assertEqual(self.change_memory(reset=True).status_code, 403)
            self.identify(self.owner)
            self.assertEqual(self.client.get(url).headers['Cache-Control'], 'private, no-store')
            saved_id = self.receipt().json()['id']
            self.assertTrue(self.ask(self.next_exhibition_work).json()['usedPreviousVisitMemory'])
            self.assertEqual(self.change_memory(enabled='false').status_code, 400)
            disabled = self.change_memory(enabled=False).json()
            self.assertFalse(disabled['enabled'])
            self.assertNotIn('usedPreviousVisitMemory', self.ask(self.next_exhibition_work).json())
            self.assertNotIn('visitorContext', self.prompt(calls))
            self.assertEqual(self.ask(earlier=[self.interest]).status_code, 200)
            self.assertIn('earlierInExhibition', self.prompt(calls)['visitorContext'])
            paused = self.receipt(visitId=str(uuid4()))
            self.assertEqual(paused.status_code, 201)
            self.assertNotIn('visit', Visit.objects.get(pk=paused.json()['id']).docent_memory)
            self.assertTrue(self.change_memory(enabled=True).json()['enabled'])
            self.assertTrue(self.ask(self.next_exhibition_work).json()['usedPreviousVisitMemory'])

            reset = self.change_memory(reset=True).json()
            self.assertIsNotNone(reset['resetAt'])
            self.assertEqual(reset['retentionDays'], 30)
            self.assertNotIn('usedPreviousVisitMemory', self.ask(self.next_exhibition_work).json())
            self.assertEqual(self.receipt().json()['id'], saved_id)
            self.assertEqual(self.client.get(recap).json()['recap']['topics'], ['빛과 명암', '색감'])
            self.assertTrue(Visit.objects.get(pk=saved_id).docent_memory['works'])
            self.assertFalse(Visit.objects.filter(user=self.owner, docent_memory__has_key='visit').exists())
            late = self.receipt(visitId=str(uuid4()))
            self.assertEqual(late.status_code, 201)
            self.assertNotIn('visit', Visit.objects.get(pk=late.json()['id']).docent_memory)
            with override_settings(ARTI_DOCENT_MEMORY_DEMO=False):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_answer_started_before_memory_disabled_is_discarded(self):
        self.identify(self.owner)
        original = providers.generate
        def generate(*args, **kwargs):
            answer = original(*args, **kwargs)
            self.assertEqual(self.change_memory(enabled=False).status_code, 200)
            return answer

        with endpoint(body=model_answer('이전 기억이 포함된 합성 응답')) as calls:
            self.receipt()
            with patch('arti.docent.providers.generate', side_effect=generate):
                result = self.ask(self.next_exhibition_work)
            self.assertEqual(result.status_code, 409)
            self.assertNotIn('answer', result.json())
            self.assertEqual(self.ask(self.next_exhibition_work).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))

    def test_expired_and_reset_memory_can_be_reconciled_after_restore(self):
        self.identify(self.owner)
        with endpoint(body=model_answer('합성 응답')) as calls, TemporaryDirectory() as directory:
            live_id = self.receipt().json()['id']
            expired_id = self.receipt(visitId=str(uuid4())).json()['id']
            live = Visit.objects.get(pk=live_id)
            expired = Visit.objects.get(pk=expired_id)
            Visit.objects.filter(pk=expired_id).update(created_at=timezone.now() - timedelta(days=31))
            self.identify(self.other)
            other_id = self.receipt().json()['id']
            Visit.objects.filter(pk=other_id).update(created_at=timezone.now() - timedelta(days=31))
            self.assertEqual(self.ask(self.next_exhibition_work).status_code, 200)
            self.assertNotIn('visitorContext', self.prompt(calls))

            self.identify(self.owner)
            self.assertEqual(self.change_memory(enabled=False).status_code, 200)
            self.assertEqual(self.change_memory(reset=True).status_code, 200)
            controls = Path(directory) / 'controls.json'
            call_command('docent_memory_controls', export=controls, stdout=io.StringIO())
            # Restore the older database state and apply the retained control file twice.
            Account.objects.filter(pk=self.owner.pk).update(docent_cross_visit_enabled=True,
                                                            docent_memory_revision=0, docent_memory_reset_at=None)
            Visit.objects.filter(pk=live_id).update(docent_memory=live.docent_memory)
            Visit.objects.filter(pk=expired_id).update(docent_memory=expired.docent_memory)
            for _ in range(2):
                call_command('docent_memory_controls', apply=controls, stdout=io.StringIO())
                owner = Account.objects.get(pk=self.owner.pk)
                self.assertFalse(owner.docent_cross_visit_enabled)
                self.assertIsNotNone(owner.docent_memory_reset_at)
                for receipt in Visit.objects.filter(pk__in=[live_id, expired_id, other_id]):
                    self.assertNotIn('visit', receipt.docent_memory)
                    self.assertIn('works', receipt.docent_memory)
            self.assertEqual(self.client.get(f'/api/visits/{live_id}').json()['id'], live_id)

    def test_visit_memory_on_and_off_use_the_same_twelve_cases(self):
        raw_protocol = PROTOCOL.read_bytes()
        cases = json.loads(raw_protocol)['cases']
        self.assertEqual(Counter(case['group'] for case in cases), {'same': 4, 'different': 3, 'evidence': 3, 'failure': 2})
        self.assertEqual(len({case['id'] for case in cases}), 12)
        Artwork.objects.filter(pk=self.current.id).update(tags=['warm'])
        fixtures = PROTOCOL.parent / 'luna-fixtures'
        evaluated_sources = {}
        for work_id, source in ((self.current.id, 'L01'), (self.next_exhibition_work, 'L02')):
            original = (fixtures / f'{source}-source-v1.txt').read_text(encoding='utf-8').strip()
            Artwork.objects.filter(pk=work_id).update(description=original, source=f'{source} 합성 원문 v1', source_version=1)
            evaluated_sources[work_id] = source
        self.identify(self.owner)
        with endpoint():
            self.assertEqual(self.receipt().status_code, 201)
        recap_url = f'/api/artworks/{self.prior.id}/liked-recap'
        original_generate = providers.generate
        report = []
        capture_path = os.environ.get('ARTI_DOCENT_SYNTHETIC_CAPTURE')
        captures = []
        for case in cases:
            inputs_without_memory = None
            model_config = None
            comparison = {}
            for enabled in (False, True):
                with self.subTest(case=case['id'], enabled=enabled), override_settings(ARTI_DOCENT_MEMORY_DEMO=enabled):
                    cache.clear()
                    Artwork.objects.filter(pk=self.prior.id).update(content_version=self.prior.content_version)
                    actor = case.get('account')
                    self.client.credentials()
                    self.owner_id = None
                    if actor:
                        self.identify(getattr(self, actor))
                    event = case.get('event')
                    work = self.next_exhibition_work if case['group'] == 'different' else self.current.id
                    if event == 'owner_mismatch':
                        self.owner_id = self.owner.id
                        self.assertEqual(self.client.get(recap_url).status_code, 404)
                    earlier = [self.interest] if case.get('earlier', True) else []
                    preferred = case.get('preferred', [])
                    answer = model_answer('합성 응답', insufficientEvidence=event == 'insufficient', sourceRefs=[
                        {'artworkId': self.prior.id, 'kind': 'original'}, {'artworkId': 'invented-source', 'kind': 'guide'},
                    ])

                    def respond(attempt):
                        return (500, b'synthetic-failure') if event == 'retry' and attempt == 1 else (200, answer)

                    def generate(*args, **kwargs):
                        result = original_generate(*args, **kwargs)
                        if event == 'revision':
                            Artwork.objects.filter(pk=self.prior.id).update(content_version=self.prior.content_version + 1)
                        return result

                    with endpoint(respond=respond) as calls, patch('arti.docent.providers.generate', side_effect=generate):
                        result = self.ask(work, earlier=earlier, preferred=preferred, question=case['question'])
                        statuses = [result.status_code]
                        if event == 'retry':
                            self.assertEqual(result.status_code, 502, result.content)
                            result = self.ask(work, earlier=earlier, preferred=preferred, question=case['question'])
                            statuses.append(result.status_code)
                            self.assertEqual(len(calls), 2)
                            self.assertEqual(calls[0]['raw'], calls[1]['raw'])
                        else:
                            self.assertEqual(len(calls), 1)
                        config = {key: val for key, val in calls[-1]['body'].items() if key != 'messages'}
                        prompt = self.prompt(calls)
                        supplied_context = prompt.pop('visitorContext', {})
                        self.assertEqual(set(supplied_context), set(case['expected']) if enabled else set())
                        if model_config is None:
                            model_config, inputs_without_memory = config, prompt
                        else:
                            self.assertEqual(config, model_config)
                            self.assertEqual(prompt, inputs_without_memory)
                        self.assertEqual(prompt['question'], case['question'])
                        self.assertNotIn('secret-raw-text', str(supplied_context))
                        if enabled and case['id'] == 'M02':
                            self.assertEqual(supplied_context['matchingTasteTags'], ['따뜻한 색감'])
                        if enabled and case['id'] == 'M04':
                            self.assertIsNone(supplied_context['earlierInExhibition'][0]['style'])
                            self.assertEqual(result.json()['interestSignal']['style'], case['currentStyle'])
                        if enabled and case['id'] == 'M05':
                            self.assertEqual(supplied_context['previousVisit']['topics'], ['빛과 명암'])
                            self.assertNotIn('artwork', supplied_context['previousVisit'])
                        if enabled and event == 'revision':
                            self.assertEqual(result.status_code, 409, result.content)
                            self.assertNotIn('answer', result.json())
                        else:
                            self.assertEqual(result.status_code, 200, result.content)
                            refs = result.json()['sourceRefs']
                            if event == 'insufficient':
                                self.assertEqual(refs, [])
                                self.assertNotEqual(result.json()['answer'], '합성 응답')
                            else:
                                self.assertEqual({ref['artworkId'] for ref in refs}, {work})
                        comparison['on' if enabled else 'off'] = statuses
                        if capture_path and case['id'] <= 'M09':
                            captures.append({
                                'id': case['id'], 'memory': enabled, 'source': evaluated_sources[work],
                                'payload': calls[-1]['body'],
                            })
            report.append({'id': case['id'], **comparison})
        if capture_path:
            self.assertEqual(len(captures), 18)
            Path(capture_path).write_text(json.dumps({
                'scope': 'synthetic-visitor-memory', 'protocolSha256': sha256(raw_protocol).hexdigest(),
                'cases': captures,
            }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if os.environ.get('ARTI_DOCENT_REPLAY_REPORT') == '1':
            print(json.dumps({'suite': 'visitor-memory-on-off', 'provider': 'loopback_mock',
                              'protocolSha256': sha256(raw_protocol).hexdigest(), 'cases': report}), flush=True)
