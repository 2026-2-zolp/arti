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
from uuid import uuid4

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

    def test_insufficient_visual_evidence_offers_only_general_observation_on_a_public_image(self):
        path = '/api/artworks/fixture-art01/ask'
        body = provider_reply('다른 작품에 있는 세부 사항입니다.', insufficientEvidence=True, sourceRefs=MIXED_REFS)
        with endpoint(body=body) as calls:
            for index, (question, tip) in enumerate([
                ('어떤 색이 쓰였나요?', '색이나 밝기'),
                ('윤곽이 어떤 모양인가요?', '윤곽을 따라'),
                ('인물은 어느 위치에 있나요?', '가운데와 가장자리'),
                ('빛을 짧게 말고 자세히 설명해 주세요.', '색이나 밝기'),
                ('앞 작품과 지금 작품의 빛을 비교해 주세요.', '색이나 밝기'),
            ]):
                with self.subTest(question=question):
                    reply = self.api.post(path, {'question': question}, format='json', REMOTE_ADDR=f'192.0.2.{51 + index}')
                    self.assertEqual(reply.status_code, 200)
                    self.assertEqual(reply.json()['mode'], 'fallback')
                    self.assertIn(tip, reply.json()['answer'])
                    self.assertNotIn('다른 작품', reply.json()['answer'])
                    self.assertEqual(reply.json()['sourceRefs'], [])
            self.assertEqual(len(calls), 5)
            for question in ('작가는 왜 이 색을 썼나요?', '어디에 소장되어 있나요?', '작가는 왜 빛을 강조해서 그렸나요?'):
                with self.subTest(question=question):
                    reply = self.api.post(path, {'question': question}, format='json', REMOTE_ADDR='192.0.2.55')
                    self.assertEqual(reply.json()['mode'], 'refusal')
                    self.assertNotIn('도판', reply.json()['answer'])
                    self.assertEqual(reply.json()['sourceRefs'], [])
            work = Artwork.objects.get(pk='fixture-art01')
            Artwork.objects.filter(pk=work.id).update(show_image=False)
            self.addCleanup(lambda: Artwork.objects.filter(pk=work.id).update(show_image=work.show_image))
            reply = self.api.post(path, {'question': '빛을 짧게 말고 자세히 설명해 주세요.'},
                                  format='json', REMOTE_ADDR='192.0.2.56')
            self.assertEqual(reply.json()['mode'], 'refusal')
            self.assertNotIn('도판', reply.json()['answer'])
            self.assertEqual(reply.json()['sourceRefs'], [])

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
            response, _ = self.ask({**case, 'entryContext': None, 'question': '어떤 색이 쓰였나요?'}, ip='192.0.2.7')
            self.assertEqual(response.json()['mode'], 'fallback')
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

    def test_matching_approved_follow_up_uses_only_its_current_hint(self):
        work = Artwork.objects.get(pk='fixture-art01')
        initial, target = work.guided_looking[0], '노란 원의 경계는 어떻게 보이나요?'
        hint = '노란 원의 둥근 경계를 따라가 보세요.'
        case = {'workId': work.id, 'question': target, 'history': [], 'entryContext': {
            'kind': 'guide', 'tab': 'guided', 'contentVersion': work.content_version, 'questionIndex': 0,
        }}
        Artwork.objects.filter(pk=work.pk).update(guided_looking=[initial, target], guided_hints=[work.guided_hints[0], hint])
        self.addCleanup(lambda: Artwork.objects.filter(pk=work.pk).update(
            guided_looking=work.guided_looking, guided_hints=work.guided_hints, guide_status=work.guide_status,
        ))

        with endpoint(body=SUCCESS) as calls:
            response, _ = self.ask(case, ip='192.0.2.31')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['sourceRefs'], [{
                'artworkId': work.id, 'sourceVersion': work.source_version, 'kind': 'guide',
                'revision': work.guide_revision,
            }])
            request = json.loads(calls[0]['body']['messages'][1]['content'])
            self.assertEqual(request['entry'], {'kind': 'guide', 'question': initial})
            self.assertEqual(request['guideEvidence'], {'question': target, 'hint': hint})
            self.assertNotIn(work.guided_hints[0], json.dumps(request, ensure_ascii=False))

            Artwork.objects.filter(pk=work.pk).update(guide_status='suggested')
            response, _ = self.ask({**case, 'entryContext': None}, ip='192.0.2.31')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertNotIn('guideEvidence', json.loads(calls[1]['body']['messages'][1]['content']))
            self.assertEqual([ref['kind'] for ref in response.json()['sourceRefs']], ['original'])

    def test_earlier_remarks_reach_provider_only_with_current_evidence(self):
        work = Artwork.objects.get(pk='fixture-art01')
        remarks = {'contentVersion': work.content_version, 'observations': ['노란 원을 등불이라고 적었어요.']}
        body = {'question': '이 대화를 시작할 때 제가 붙인 말은 뭐였나요?', 'history': [],
                'visitId': str(uuid4()), 'docentEvidenceRevision': 0, 'earlierConversation': remarks}
        path = f'/api/artworks/{work.pk}/ask'
        with endpoint(body=SUCCESS) as calls:
            response = self.api.post(path, body, format='json', REMOTE_ADDR='192.0.2.78')
            self.assertEqual(response.status_code, 200, response.content)
            prompt = json.loads(calls[0]['body']['messages'][1]['content'])
            self.assertEqual(prompt['earlierUserRemarks'], remarks['observations'])
            self.assertEqual({ref['artworkId'] for ref in response.json()['sourceRefs']}, {work.pk})
            for change, expected in [({'contentVersion': work.content_version + 1}, 409),
                                     ({'observations': ['원'] * 3}, 400), ({'observations': ['']}, 400)]:
                invalid = {**body, 'earlierConversation': {**remarks, **change}}
                self.assertEqual(self.api.post(path, invalid, format='json', REMOTE_ADDR='192.0.2.78').status_code, expected)
            self.assertEqual(len(calls), 1)

    def test_unspecified_past_reference_asks_once_without_a_provider_call(self):
        work = Artwork.objects.get(pk='fixture-art01')
        path = f'/api/artworks/{work.pk}/ask'
        body = {'history': [
            {'role': 'user', 'text': '선은 어디로 이어지나요?'},
            {'role': 'assistant', 'text': '선의 경계를 따라 살펴보세요.'},
            {'role': 'user', 'text': '어느 색을 보면 좋을까요?'},
            {'role': 'assistant', 'text': '노란 부분부터 살펴보세요.'},
        ]}
        with endpoint(body=SUCCESS) as calls:
            response = self.api.post(path, {**body, 'question': '그때 그거요. 뭐였죠?'}, format='json')
            self.assertEqual(response.status_code, 200, response.content)
            data = response.json()
            self.assertIn('어느 부분', data['answer'])
            self.assertEqual(data['mode'], 'refusal')
            self.assertEqual(data['sourceRefs'], [])
            self.assertNotIn('audioGrant', data)
            self.assertEqual(len(calls), 0)
            recent = self.api.post(path, {**body, 'question': '그 색은 어디에 보여요?'}, format='json')
            self.assertEqual(recent.status_code, 200, recent.content)
            self.assertEqual(len(calls), 1)

    def test_dialogue_order_sends_the_selected_remark_without_competing_history(self):
        work = Artwork.objects.get(pk='fixture-art01')
        path = f'/api/artworks/{work.pk}/ask'
        reference = {'contentVersion': work.content_version, 'reference': 'dialogue_order',
                     'observations': ['노란 원의 가장자리를 먼저 봤다고 말했어요.']}
        body = {'question': '맨 처음 거요. 어디였죠?', 'visitId': str(uuid4()), 'docentEvidenceRevision': 0,
                'history': [{'role': 'user', 'text': '나중에 어느 얼굴을 볼까요?'},
                            {'role': 'assistant', 'text': '세 얼굴 중 먼저 보는 위치를 살펴보세요.'}]}
        with endpoint(body=SUCCESS) as calls:
            response = self.api.post(path, {**body, 'earlierConversation': reference}, format='json')
            self.assertEqual(response.status_code, 200, response.content)
            prompt = json.loads(calls[0]['body']['messages'][1]['content'])
            self.assertEqual(prompt['referencedUserTurn'], reference['observations'][0])
            self.assertEqual(prompt['history'], [])
            self.assertNotIn('earlierUserRemarks', prompt)
            for change in ({'reference': 'other'}, {'observations': ['하나', '둘']}):
                invalid = {**reference, **change}
                response = self.api.post(path, {**body, 'earlierConversation': invalid}, format='json')
                self.assertEqual(response.status_code, 400)
            unresolved = {**reference, 'observations': []}
            clarification = self.api.post(path, {**body, 'earlierConversation': unresolved}, format='json')
            self.assertIn('어느 부분', clarification.json()['answer'])
            self.assertEqual(len(calls), 1)

    def test_excerpt_rebuilds_context_from_the_current_approved_text(self):
        case = next(case for case in self.cases if case['id'] == 'D01-first')
        work = Artwork.objects.get(pk=case['workId'])
        prefix = '합성 안내 🟡 '
        original = '파란 바탕의 경계'
        summary = '노란 원의 위치'
        Artwork.objects.filter(pk=work.pk).update(
            description=prefix + original + '를 살펴보세요.',
            summary=prefix + summary + '를 찾아보세요.',
        )
        self.addCleanup(lambda: Artwork.objects.filter(pk=work.pk).update(
            description=work.description, summary=work.summary,
        ))
        forged = '다른 작품에 속한 문장'
        with endpoint(body=SUCCESS) as calls:
            for kind, excerpt, revision in (
                ('original', original, work.source_version),
                ('summary', summary, work.summary_revision),
            ):
                with self.subTest(kind=kind):
                    context = {
                        'tab': 'desc', 'kind': kind, 'contentVersion': work.content_version,
                        'excerpt': {'start': len(prefix), 'end': len(prefix + excerpt), 'text': forged},
                    }
                    response, _ = self.ask({**case, 'entryContext': context}, ip='192.0.2.9')
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(response.json()['sourceRefs'], [{
                        'artworkId': work.id, 'sourceVersion': work.source_version,
                        'kind': kind, 'revision': revision,
                    }])
                    prompt = json.loads(calls[-1]['body']['messages'][1]['content'])
                    self.assertEqual(prompt['entry'], {'kind': kind, 'text': excerpt})
                    self.assertNotIn(forged, json.dumps(prompt, ensure_ascii=False))
            self.assertEqual(len(calls), 2)

    def test_invalid_entry_context_never_reaches_the_provider(self):
        case = next(case for case in self.cases if case['id'] == 'D01-first')
        work = Artwork.objects.get(pk=case['workId'])
        original = {'tab': 'desc', 'kind': 'original', 'contentVersion': work.content_version}
        guide = {'tab': 'guided', 'kind': 'guide', 'contentVersion': work.content_version}
        entries = [
            {**original, 'excerpt': {'start': True, 'end': 2}},
            {**original, 'excerpt': {'start': 0, 'end': len(work.description) + 1}},
            {**original, 'questionIndex': 0},
            {**guide, 'questionIndex': 0, 'excerpt': {'start': 0, 'end': 1}},
            {**guide, 'questionIndex': len(work.guided_looking)},
            {**guide, 'kind': 'generic_tip', 'questionIndex': 0, 'tipVersion': 'unknown'},
        ]
        with endpoint(body=SUCCESS) as calls:
            for entry in entries:
                with self.subTest(entry=entry):
                    response, _ = self.ask({**case, 'entryContext': entry}, ip='192.0.2.10')
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertEqual(response.json()['code'], 'VALIDATION_ERROR')
                    self.assertNotIn('sourceRefs', response.json())
            self.assertEqual(calls, [])

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
