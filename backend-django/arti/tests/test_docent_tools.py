"""Exercise the actual Chat Completions exchange with a loopback provider."""

import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from arti.docent_tools import DemoTool, ToolObservation, check_catalog_accession, demo_tool_for, official_catalog_url
from arti.models import Artwork
from arti.tests.test_provider import endpoint


FIXTURE_IMAGE = Path(__file__).resolve().parents[3] / 'docs/review/docent-2026-11-15/luna-fixtures/L01-v1.png'
MUSEUM_QUESTION = '[합성 도구] 소장처 기록에서 제작 배경을 확인해 주세요.'
IMAGE_QUESTION = '[합성 도구] 도판에서 위치를 다시 확인해 주세요.'
MUSEUM_TOOL = 'lookup_museum_record'
IMAGE_TOOL = 'inspect_approved_artwork'
COLLECTION = {'url': 'https://museum.example.test/works/fixture-03', 'accession': 'ARTI-5690-03',
              'excerpt': '합성 기록에는 색면 구성을 연구하기 위한 그림이라고 적혀 있어요.',
              'revision': 2, 'sourceVersion': 1}


def response(finish, message):
    return json.dumps({'choices': [{'finish_reason': finish, 'message': message}]}).encode()


def tool_call(name, **arguments):
    return {'id': 'call-test-1', 'type': 'function',
            'function': {'name': name, 'arguments': json.dumps(arguments)}}


def model_answer(text, **fields):
    return response('stop', {'content': json.dumps({'answer': text, **fields})})


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_DOCENT_TOOL_DEMO=True,
                   ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-docent-tool',
                   OPENAI_MODEL='synthetic-docent-tool', ARTI_LLM_MODELS={})
class DocentToolTests(TestCase):
    def setUp(self):
        media = self.enterContext(TemporaryDirectory())
        self.enterContext(override_settings(MEDIA_ROOT=Path(media)))
        cache.clear()
        call_command('load_test_fixture', stdout=io.StringIO())
        self.image = Path(media) / 'agent-demo.png'
        self.image.write_bytes(FIXTURE_IMAGE.read_bytes())
        Artwork.objects.filter(pk='fixture-art03').update(image_file=self.image.name)
        self.client = APIClient(HTTP_HOST='localhost')

    def ask(self, question, work_id='fixture-art03'):
        return self.client.post(f'/api/artworks/{work_id}/ask', {'question': question}, format='json')

    def approve_collection(self, **changes):
        Artwork.objects.filter(pk='fixture-art03').update(docent_collection={
            'version': 2, 'approved': {**COLLECTION, **changes},
        })

    def test_catalog_url_is_derived_only_from_known_institution_routes(self):
        boe = 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2017-3315'
        self.assertEqual(official_catalog_url(boe + '#documento'), boe)
        for url in ('http://www.boe.es/diario_boe/txt.php?id=BOE-A-2017-3315',
                    boe + '&next=http://localhost', 'https://www.boe.es.evil.test/diario_boe/txt.php',
                    'https://alice@www.boe.es/diario_boe/txt.php?id=BOE-A-2017-3315',
                    'https://www.boe.es:8443/diario_boe/txt.php?id=BOE-A-2017-3315',
                    'https://hispanicsociety.emuseum.com/redirect', 'https://127.0.0.1/'):
            self.assertIsNone(official_catalog_url(url), url)
        with patch('arti.docent_tools.fetch_catalog_text') as fetch:
            self.assertEqual(check_catalog_accession({'url': 'https://127.0.0.1/', 'accession': 'LA1791'}), 'unverified')
            fetch.assert_not_called()

    @override_settings(ARTI_DOCENT_COLLECTION_TOOL_EXHIBITIONS={'fixture-ex01'},
                       ARTI_DOCENT_LIVE_COLLECTION_EXHIBITIONS={'fixture-ex01'}, ARTI_DOCENT_TOOL_DEMO=False)
    def test_live_lookup_exposes_only_match_status_and_preserves_approved_excerpt_on_failure(self):
        source = 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2017-3315'
        self.approve_collection(url=source, accession='LA1791')
        call = tool_call(MUSEUM_TOOL, topic='collection')

        for raw, expected in [('LA1791 Only the status may cross the model boundary.', 'accession_found'),
                              ('LA17910 Not the same artwork.', 'unverified'), (None, 'unverified')]:
            with self.subTest(raw=raw), patch('arti.docent_tools.fetch_catalog_text', return_value=raw) as fetch:
                def respond(attempt):
                    if attempt == 1:
                        return 200, response('tool_calls', {'tool_calls': [call]})
                    return 200, model_answer(COLLECTION['excerpt'], collectionEvidenceUsed=True)

                with endpoint(respond=respond) as calls:
                    result = self.ask('소장번호가 뭔가요?')
                    self.assertEqual(result.status_code, 200, result.content)
                    payload = json.loads(calls[1]['body']['messages'][-1]['content'])
                    self.assertEqual(payload, {'status': 'approved', 'excerpt': COLLECTION['excerpt'],
                                               'currentRecord': expected})
                    self.assertEqual(result.json()['sourceRefs'][-1]['url'], source)
                fetch.assert_called_once_with(source)

    def test_plain_question_keeps_original_request_and_does_not_run_tool(self):
        with endpoint(body=model_answer('합성 일반 응답')) as calls, patch.object(DemoTool, 'run') as run:
            result = self.ask('색을 먼저 볼까요?')
            self.assertEqual(result.status_code, 200)
            run.assert_not_called()
            self.assertEqual(len(calls), 1)
            self.assertNotIn('tools', calls[0]['body'])

    @override_settings(ARTI_DOCENT_COLLECTION_TOOL_EXHIBITIONS={'fixture-ex01'}, ARTI_DOCENT_TOOL_DEMO=False)
    def test_enrolled_exhibition_looks_up_only_approved_record_for_explicit_collection_question(self):
        self.approve_collection(accession='A04-APPROVED')
        question = '이 작품의 소장처 자료에서 무엇을 확인할 수 있나요?'
        call = tool_call(MUSEUM_TOOL, topic='collection')

        def mock(attempt):
            if attempt == 1:
                return 200, response('tool_calls', {'tool_calls': [call]})
            return 200, model_answer(COLLECTION['excerpt'], collectionEvidenceUsed=True)

        with endpoint(respond=mock) as calls:
            result = self.ask(question)
            self.assertEqual(result.status_code, 200, result.content)
            first, second = (item['body'] for item in calls)
            initial = json.loads(first['messages'][1]['content'])
            self.assertNotIn('excerpt', initial['collectionEvidence'])
            self.assertEqual(first['tool_choice']['function']['name'], MUSEUM_TOOL)
            self.assertEqual(second['tool_choice'], 'none')
            self.assertNotIn('reasoning_effort', first)
            self.assertNotIn('reasoning_effort', second)
            self.assertEqual(json.loads(second['messages'][-1]['content'])['excerpt'], COLLECTION['excerpt'])
            self.assertEqual(result.json()['sourceRefs'][-1]['accession'], 'A04-APPROVED')

        with endpoint(body=model_answer('도구 없이 답변', collectionEvidenceUsed=True)):
            self.assertEqual(self.ask(question).status_code, 502)

    @override_settings(OPENAI_MODEL='gpt-6-luna', OPENAI_BASE_URL='https://api.openai.com/v1',
                       ARTI_DOCENT_COLLECTION_TOOL_EXHIBITIONS={'fixture-ex01'}, ARTI_DOCENT_TOOL_DEMO=False)
    def test_luna_uses_no_reasoning_for_catalog_tool_exchange_only(self):
        self.approve_collection()
        call = tool_call(MUSEUM_TOOL, topic='collection')
        opted_out = model_answer('일반 답변', collectionEvidenceUsed=False, safetyRoute='answer')
        gate = model_answer('', safetyRoute='answer')
        lookup_reply = response('tool_calls', {'tool_calls': [call]})
        accession = COLLECTION['accession']
        replies = (opted_out, gate, lookup_reply,
                   model_answer(f'소장번호는 {accession}으로 기록돼요.', collectionEvidenceUsed=False, safetyRoute='answer'),
                   gate, lookup_reply,
                   model_answer(f'소장번호는 {accession}0으로 기록돼요.', collectionEvidenceUsed=False, safetyRoute='answer'))
        with patch('arti.llm.request_choice', side_effect=[json.loads(reply)['choices'][0] for reply in replies]) as sent:
            self.assertEqual(self.ask('색을 먼저 볼까요?').status_code, 200)
            result = self.ask('소장처 기록에서 확인할 수 있는 제작 배경은 뭔가요?')
            self.assertEqual(result.status_code, 200)
            similar = self.ask('소장번호는 무엇인가요?')
            self.assertEqual(similar.status_code, 200)
        plain, check, lookup, answer = (json.loads(request.args[4]) for request in sent.call_args_list[:4])
        self.assertNotIn('reasoning_effort', plain)
        self.assertNotIn('tools', check)
        self.assertEqual(set(json.loads(check['messages'][1]['content'])), {'artworkTitle', 'question', 'history'})
        self.assertEqual(lookup['reasoning_effort'], 'none')
        self.assertEqual(answer['reasoning_effort'], 'none')
        self.assertEqual(result.json()['sourceRefs'][-1]['url'], COLLECTION['url'])
        self.assertFalse(any(ref['kind'] == 'collection' for ref in similar.json()['sourceRefs']))

    def test_approved_museum_lookup_runs_once_and_only_server_approved_link_is_used(self):
        self.approve_collection()
        call = tool_call(MUSEUM_TOOL, topic='creation')

        def mock(attempt):
            if attempt == 1:
                return 200, response('tool_calls', {'tool_calls': [call]})
            return 200, model_answer(COLLECTION['excerpt'], collectionEvidenceUsed=True,
                                     sourceRefs=[{'kind': 'collection', 'url': 'https://forged.example.test/'}])

        with endpoint(respond=mock) as calls:
            result = self.ask(MUSEUM_QUESTION)
            self.assertEqual(result.status_code, 200, result.content)
            self.assertEqual(len(calls), 2)
            initial, followup = (wire['body'] for wire in calls)
            self.assertFalse(initial['parallel_tool_calls'])
            definition = initial['tools'][0]['function']
            self.assertTrue(definition['strict'])
            self.assertFalse(definition['parameters']['additionalProperties'])
            self.assertEqual(followup['tool_choice'], 'none')
            self.assertEqual(followup['messages'][-1]['tool_call_id'], call['id'])
            self.assertEqual(json.loads(followup['messages'][-1]['content']),
                             {'status': 'approved', 'excerpt': COLLECTION['excerpt']})
        self.assertEqual(result.json()['sourceRefs'][-1]['url'], COLLECTION['url'])
        self.assertNotIn('forged.example.test', str(result.json()))

    def test_draft_and_wrong_accession_do_not_reach_second_model_call(self):
        Artwork.objects.filter(pk='fixture-art03').update(docent_collection={'version': 1, 'draft': COLLECTION})
        wire = response('tool_calls', {'tool_calls': [tool_call(MUSEUM_TOOL, topic='creation')]})
        with endpoint(body=wire) as calls:
            self.assertEqual(self.ask(MUSEUM_QUESTION).json()['sourceRefs'], [])
            self.approve_collection(accession='OTHER-ARTWORK')
            wrong = self.ask(MUSEUM_QUESTION)
            self.assertEqual(wrong.json()['mode'], 'refusal')
            self.assertEqual(wrong.json()['sourceRefs'], [])
            self.assertEqual(len(calls), 2)

    def test_image_observation_is_local_and_fails_closed_on_image_change(self):
        wire = response('tool_calls', {'tool_calls': [tool_call(IMAGE_TOOL, topic='placement')]})
        with endpoint(body=wire) as calls:
            accepted = self.ask(IMAGE_QUESTION).json()
            self.assertEqual(accepted['mode'], 'fallback')
            self.assertIn('왼쪽 위의 노란 원', accepted['answer'])
            self.assertEqual(accepted['sourceRefs'], [])
            self.image.write_bytes(b'different image')
            changed = self.ask(IMAGE_QUESTION).json()
            self.assertNotIn('노란 원', changed['answer'])
            Artwork.objects.filter(pk='fixture-art03').update(show_image=False)
            hidden = self.ask(IMAGE_QUESTION).json()
            self.assertEqual(hidden['mode'], 'refusal')
            self.assertEqual(len(calls), 3)
            self.assertTrue(all(isinstance(item['body']['messages'][1]['content'], str) for item in calls))

    def test_unknown_extra_and_multiple_calls_are_rejected_before_execution(self):
        valid = tool_call(IMAGE_TOOL, topic='color')
        cases = ([tool_call(MUSEUM_TOOL, topic='creation')], [tool_call(IMAGE_TOOL, topic='color', artworkId='other')],
                 [valid, valid], [tool_call(IMAGE_TOOL, topic='private')])
        for calls in cases:
            with self.subTest(calls=calls), endpoint(body=response('tool_calls', {'tool_calls': calls})):
                with patch.object(DemoTool, 'run') as run:
                    denied = self.ask(IMAGE_QUESTION)
                    self.assertEqual(denied.status_code, 502)
                    run.assert_not_called()

    def test_repeat_tool_call_and_tool_timeout_never_start_another_tool_round(self):
        self.approve_collection()
        call = response('tool_calls', {'tool_calls': [tool_call(MUSEUM_TOOL, topic='creation')]})
        with endpoint(body=call) as calls:
            self.assertEqual(self.ask(MUSEUM_QUESTION).status_code, 502)
            self.assertEqual(len(calls), 2, 'Even a second tool request must stop here.')
        with endpoint(body=call) as calls, patch.object(DemoTool, 'run', side_effect=TimeoutError):
            self.assertEqual(self.ask(MUSEUM_QUESTION).status_code, 504)
            self.assertEqual(len(calls), 1)

    def test_stale_image_observation_is_rejected_when_work_changes_during_tool_call(self):
        wire = response('tool_calls', {'tool_calls': [tool_call(IMAGE_TOOL, topic='placement')]})

        def replace_picture(topic):
            Artwork.objects.filter(pk='fixture-art03').update(content_version=2)
            return ToolObservation('이전 도판의 노란 원')

        with endpoint(body=wire) as calls, patch.object(DemoTool, 'run', side_effect=replace_picture):
            changed = self.ask(IMAGE_QUESTION)
            self.assertEqual(changed.status_code, 409)
            self.assertEqual(changed.json()['code'], 'CONTENT_CHANGED')
            self.assertNotIn('노란 원', str(changed.json()))
            self.assertEqual(len(calls), 1)

    def test_natural_requests_production_nonlocal_or_nonfixture_cannot_enable_demo(self):
        work = Artwork.objects.get(pk='fixture-art03')
        with override_settings(OPENAI_BASE_URL='http://127.0.0.1:8004/v1'):
            self.assertIsNotNone(demo_tool_for(work, MUSEUM_QUESTION, None))
            self.assertIsNone(demo_tool_for(work, '소장처를 확인해 주세요.', None))
            with override_settings(ARTI_ENV='production'):
                self.assertIsNone(demo_tool_for(work, MUSEUM_QUESTION, None))
            work.exhibition_id = 'spain500-sac-2026'
            self.assertIsNone(demo_tool_for(work, MUSEUM_QUESTION, None))
        work.exhibition_id = 'fixture-ex01'
        with override_settings(OPENAI_BASE_URL='https://external.example.test/v1'):
            self.assertIsNone(demo_tool_for(work, MUSEUM_QUESTION, None))
