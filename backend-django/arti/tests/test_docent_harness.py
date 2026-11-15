"""Replay the recorded synthetic questions through the product API and a local provider."""

import hashlib
import io
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from time import monotonic
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from arti.models import Artwork, Visit, VisitReaction
from arti.tests.test_provider import endpoint


BASELINE = (
    Path(__file__).resolve().parents[3]
    / 'docs/execution-plan/2026-11-07/records/docent-baseline-2026-11-09'
)
ANSWER = '합성 응답입니다. 작품에서 가까운 두 색을 비교해 보세요.'
SUMMARY = '파란 바탕과 노란 원을 비교할 수 있어요.'
MIXED_REFS = [
    {'artworkId': 'fixture-art01', 'sourceVersion': 99, 'kind': 'summary', 'revision': 99},
    {'artworkId': 'fixture-art02', 'sourceVersion': 2, 'kind': 'guide', 'revision': 4},
    {'artworkId': 'forged-work', 'kind': 'summary'},
]


def provider_reply(answer, **fields):
    return json.dumps({'choices': [{
        'finish_reason': 'stop',
        'message': {'content': json.dumps({'answer': answer, **fields})},
    }]}).encode()


SUCCESS = provider_reply(ANSWER, sourceRefs=MIXED_REFS)


def digest(value):
    return hashlib.sha256(value).hexdigest()


@override_settings(
    ARTI_ENV='test',
    ALLOW_TEST_FIXTURES=True,
    ARTI_LLM_PROVIDER='openai_compatible',
    OPENAI_API_KEY='synthetic-docent-harness',
    OPENAI_MODEL='synthetic-docent-harness',
    ARTI_LLM_MODELS={},
    ARTI_LLM_JSON_MODE=True,
    ARTI_LLM_TOKEN_PARAMETER='max_completion_tokens',
    CACHES={'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'docent-replay-tests',
    }},
)
class DocentHarnessTests(TestCase):
    """Keep the baseline APIClient path and replay the original request history verbatim."""

    @classmethod
    def setUpTestData(cls):
        raw = (BASELINE / 'protocol.json').read_bytes()
        cls.protocol_hash = digest(raw)
        cls.protocol = json.loads(raw)
        recorded = json.loads((BASELINE / 'targeted-results.json').read_text(encoding='utf-8'))
        cls.recorded_protocol_hash = recorded['protocolSha256']
        cls.cases = recorded['outputs']
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=Path(media)):
            call_command('load_test_fixture', stdout=io.StringIO())
        artwork = cls.protocol['artwork']
        for work_id, suffix in [('fixture-art01', ''), ('fixture-art02', cls.protocol['boundaries'][1]['descriptionSuffix'])]:
            Artwork.objects.filter(pk=work_id).update(
                title=artwork['title'] + (' B' if suffix else ''),
                artist=artwork['artist'], year=artwork['year'], description=artwork['description'] + suffix,
                review_status='approved', summary=SUMMARY,
                summary_status='confirmed', guide_status='confirmed', guide_intro='합성 관찰 가이드',
                guided_looking=[artwork['guide']], guided_hints=['원과 바탕을 번갈아 보세요.'],
                source_version=2, summary_revision=3, guide_revision=4,
            )

    def setUp(self):
        self.api = APIClient(HTTP_HOST='localhost')
        self.before = self.snapshot()
        self.addCleanup(lambda: self.assertEqual(self.snapshot(), self.before, '도슨트 호출로 데이터가 변경됐어요.'))

    def snapshot(self):
        models = (Artwork, Visit, VisitReaction)
        return [list(model.objects.order_by('pk').values()) for model in models]

    @staticmethod
    def request_body(case):
        body = {'question': case['question'], 'history': case['history']}
        if case['entryContext'] is not None:
            body['entryContext'] = case['entryContext']
        return body

    def ask(self, case, *, ip):
        started = monotonic()
        response = self.api.post(
            f"/api/artworks/{case['workId']}/ask", self.request_body(case), format='json', REMOTE_ADDR=ip,
        )
        return response, round((monotonic() - started) * 1000, 1)

    def check_success(self, case, response, wire):
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        context = case['entryContext'] or {}
        kind = context.get('kind', 'original')
        self.assertEqual(result['sourceRefs'], [{
            'artworkId': case['workId'], 'sourceVersion': 2, 'kind': kind,
            'revision': {'original': 2, 'summary': 3, 'guide': 4}[kind],
        }])
        self.assertEqual(result['mode'], 'llm')
        self.assertEqual(result['answer'], ANSWER)
        self.assertEqual(wire['path'], '/v1/chat/completions')
        prompt = json.loads(wire['body']['messages'][1]['content'])
        self.assertEqual(prompt['artworkData']['id'], case['workId'])
        self.assertEqual(prompt['question'], case['question'])
        self.assertEqual(prompt['history'], case['history'])
        artwork = self.protocol['artwork']
        suffix = self.protocol['boundaries'][1]['descriptionSuffix'] if case['workId'] == 'fixture-art02' else ''
        self.assertEqual(prompt['artworkData']['description'], artwork['description'] + suffix)
        entries = {
            'original': {'kind': 'original', 'text': artwork['description']},
            'summary': {'kind': 'summary', 'text': SUMMARY},
            'guide': {'kind': 'guide', 'question': artwork['guide']},
        }
        self.assertEqual(prompt['entry'], entries.get(context.get('kind')))
        return result['sourceRefs']

    def report(self, name, rows):
        if os.environ.get('ARTI_DOCENT_REPLAY_REPORT') == '1':
            print(json.dumps({
                'suite': name, 'provider': 'loopback_mock', 'protocolSha256': self.protocol_hash,
                'cases': rows,
            }, ensure_ascii=False), flush=True)

    def test_frozen_questions_and_histories_replay_twice(self):
        self.assertEqual(self.protocol_hash, (BASELINE / 'protocol.sha256').read_text().strip())
        self.assertEqual(self.protocol_hash, self.recorded_protocol_hash)
        questions = {
            f"{scenario['id']}-{turn}": scenario[turn]
            for scenario in self.protocol['scenarios'] for turn in ('first', 'followup')
        }
        questions.update({case['id']: case['question'] for case in self.protocol['boundaries']})
        for scenario_id in self.protocol['ablation']['scenarioIds']:
            questions[f'{scenario_id}-no-context'] = questions[f'{scenario_id}-followup']
        self.assertEqual(len(self.cases), len(questions))
        self.assertEqual({case['id']: case['question'] for case in self.cases}, questions)
        first_hashes = {}
        report = []
        with endpoint(body=SUCCESS) as calls:
            for run in (1, 2):
                for case in self.cases:
                    with self.subTest(round=run, case=case['id']):
                        before = len(calls)
                        response, elapsed = self.ask(case, ip=f'192.0.2.{run}')
                        self.assertEqual(len(calls), before + 1)
                        refs = self.check_success(case, response, calls[-1])
                        wire_hash = digest(calls[-1]['raw'])
                        self.assertEqual(first_hashes.setdefault(case['id'], wire_hash), wire_hash)
                        report.append({
                            'round': run, 'id': case['id'], 'status': response.status_code,
                            'providerPayloadSha256': wire_hash, 'sourceRefs': refs, 'elapsedMs': elapsed,
                        })
        self.report('frozen-replay', report)

    def test_original_and_summary_sources_and_stale_version(self):
        case = next(case for case in self.cases if case['id'] == 'D01-first')
        report = []
        with endpoint(body=SUCCESS) as calls:
            for kind in ('original', 'summary'):
                with self.subTest(kind=kind):
                    current = {**case, 'entryContext': {'tab': 'desc', 'kind': kind, 'contentVersion': 1}}
                    response, elapsed = self.ask(current, ip='192.0.2.3')
                    refs = self.check_success(current, response, calls[-1])
                    report.append({'id': kind, 'status': response.status_code, 'sourceRefs': refs, 'elapsedMs': elapsed})
            self.assertEqual(len(calls), 2)
            stale = {**case, 'entryContext': {**case['entryContext'], 'contentVersion': 2}}
            response, elapsed = self.ask(stale, ip='192.0.2.3')
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['code'], 'CONTENT_CHANGED')
            self.assertEqual(len(calls), 2)
            report.append({'id': 'stale', 'status': response.status_code, 'providerCalls': 0, 'elapsedMs': elapsed})
        self.report('source-refs', report)

    def test_insufficient_evidence_discards_provider_claim_and_mixed_refs(self):
        case = next(case for case in self.cases if case['id'] == 'B01')
        body = provider_reply('다른 합성 작품에 기록된 사건 때문에 제작했습니다.',
                              insufficientEvidence=True, sourceRefs=MIXED_REFS)
        with endpoint(body=body) as calls:
            response, _ = self.ask(case, ip='192.0.2.6')
            self.assertEqual(len(calls), 1)
        self.assertEqual(response.status_code, 200, response.content)
        reply = response.json()
        self.assertEqual(reply['mode'], 'refusal')
        self.assertIn('등록된 작품 자료에서 확인할 수 없어요', reply['answer'])
        self.assertNotIn('다른 합성 작품', reply['answer'])
        self.assertEqual(reply['sourceRefs'], [])

    def test_missing_work_evidence_skips_provider(self):
        case = next(case for case in self.cases if case['id'] == 'B01')
        w = Artwork.objects.get(pk=case['workId'])
        Artwork.objects.filter(pk=w.pk).update(description='   ')
        self.addCleanup(lambda: Artwork.objects.filter(pk=w.pk).update(description=w.description))
        contexts = [
            None,
            {'kind': 'original', 'tab': 'desc', 'contentVersion': w.content_version},
            {'kind': 'generic_tip', 'tab': 'guided', 'contentVersion': w.content_version,
             'questionIndex': 0, 'tipVersion': 'basic-v1'},
        ]
        with endpoint(body=SUCCESS) as calls:
            for context in contexts:
                with self.subTest(context=context):
                    response, _ = self.ask({**case, 'entryContext': context}, ip='192.0.2.7')
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(response.json()['mode'], 'refusal')
                    self.assertEqual(response.json()['sourceRefs'], [])
            self.assertEqual(len(calls), 0)

            # A visitor who selected a confirmed guide question still has a source for that entry.
            guide = {'kind': 'guide', 'tab': 'guided', 'contentVersion': w.content_version,
                     'questionIndex': 0}
            response, _ = self.ask({**case, 'entryContext': guide, 'question': '어디부터 보면 좋을까요?'}, ip='192.0.2.7')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(len(calls), 1)
            self.assertEqual(response.json()['sourceRefs'], [{
                'artworkId': w.id, 'sourceVersion': w.source_version, 'kind': 'guide',
                'revision': w.guide_revision,
            }])

    def test_invalid_evidence_discriminator_is_provider_error(self):
        case = next(case for case in self.cases if case['id'] == 'B01')
        with endpoint(body=provider_reply(ANSWER, insufficientEvidence='false')) as calls:
            response, _ = self.ask(case, ip='192.0.2.8')
            self.assertEqual(len(calls), 1)
        self.assertEqual(response.status_code, 502, response.content)
        self.assertEqual(response.json()['code'], 'PROVIDER_ERROR')
        self.assertNotIn('answer', response.json())

    def test_provider_errors_allow_same_request_retry(self):
        case = next(case for case in self.cases if case['id'] == 'D01-followup')
        report = []
        for failure, status, code in [
            (500, 502, 'PROVIDER_ERROR'), (429, 429, 'RATE_LIMITED'), ('timeout', 504, 'AI_TIMEOUT'),
        ]:
            with self.subTest(failure=failure):
                release = Event()

                def respond(attempt):
                    if attempt > 1:
                        return 200, SUCCESS
                    if failure == 'timeout':
                        release.wait(timeout=4)
                        return 200, SUCCESS
                    return failure, b'SYNTHETIC_UPSTREAM_DEBUG'

                with endpoint(respond=respond) as calls, patch('arti.llm.TIMEOUT_SECONDS', .5):
                    try:
                        failed, elapsed = self.ask(case, ip='192.0.2.4')
                    finally:
                        release.set()
                    self.assertEqual(len(calls), 1, '서버가 사용자 요청 없이 재시도했어요.')
                    self.assertEqual(failed.status_code, status, failed.content)
                    self.assertEqual(failed.json()['code'], code)
                    self.assertIs(failed.json()['retryable'], True)
                    self.assertNotIn(b'SYNTHETIC_UPSTREAM_DEBUG', failed.content)
                    if status == 429:
                        self.assertEqual(failed.headers.get('Retry-After'), '30')
                    retried, retry_elapsed = self.ask(case, ip='192.0.2.4')
                    self.assertEqual(len(calls), 2)
                    self.assertEqual(calls[0]['raw'], calls[1]['raw'])
                    refs = self.check_success(case, retried, calls[1])
                    report.append({
                        'id': case['id'], 'failureStatus': status, 'failureCode': code,
                        'retryAfter': failed.headers.get('Retry-After'), 'retryStatus': retried.status_code,
                        'providerPayloadSha256': digest(calls[0]['raw']), 'sourceRefs': refs,
                        'elapsedMs': elapsed, 'retryElapsedMs': retry_elapsed,
                    })
        self.report('explicit-retry', report)

    def test_response_is_rejected_when_artwork_changes_during_generation(self):
        case = next(case for case in self.cases if case['id'] == 'D01-followup')
        initial = Artwork.objects.get(pk=case['workId'])
        for changes in (
            {'content_version': initial.content_version + 1},
            {'review_status': 'source_check'},
        ):
            with self.subTest(changes=changes):
                def respond(*_args, **_kwargs):
                    # Same DB connection as the request, immediately before the adapter returns.
                    Artwork.objects.filter(pk=initial.pk).update(**changes)
                    return {'answer': ANSWER}

                try:
                    with patch('arti.providers.generate', side_effect=respond) as provider:
                        response, _ = self.ask(case, ip='192.0.2.5')
                    self.assertEqual(provider.call_count, 1)
                    self.assertEqual(response.status_code, 409, response.content)
                    self.assertEqual(response.json()['code'], 'CONTENT_CHANGED')
                    self.assertNotIn('answer', response.json())
                    self.assertNotIn('sourceRefs', response.json())
                finally:
                    Artwork.objects.filter(pk=initial.pk).update(
                        content_version=initial.content_version, review_status=initial.review_status,
                    )
