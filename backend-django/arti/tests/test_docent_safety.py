import io
import json
from urllib.error import URLError
from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from arti.docent_safety import NOTICES
from arti.docent_transcript import grant_transcript_consent
from arti.member import issue
from arti.models import Account, Artwork, DocentTranscript
from arti.tests.test_docent_tools import COLLECTION


ASK = '/api/artworks/fixture-art03/ask'


def reply(route, answer='', **fields):
    return {'finish_reason': 'stop', 'message': {'content': json.dumps({
        'answer': answer, 'safetyRoute': route, **fields,
    })}}


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_LLM_PROVIDER='openai_compatible',
                   OPENAI_BASE_URL='https://api.openai.com/v1', OPENAI_API_KEY='synthetic-only',
                   OPENAI_MODEL='gpt-6-luna', ARTI_LLM_MODELS={}, ARTI_DOCENT_AUDIO_EXHIBITIONS={'fixture-ex01'},
                   ARTI_DOCENT_TRANSCRIPTS_ENABLED=True, ARTI_DOCENT_COLLECTION_TOOL_EXHIBITIONS={'fixture-ex01'},
                   ARTI_DOCENT_LIVE_COLLECTION_EXHIBITIONS={'fixture-ex01'})
class DocentSafetyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('load_test_fixture', stdout=io.StringIO())
        cls.member = Account.objects.create(login_id='safety@example.test', role='user')
        grant_transcript_consent(cls.member)
        Artwork.objects.filter(pk='fixture-art03').update(docent_collection={'version': 2, 'approved': COLLECTION})

    def setUp(self):
        cache.clear()
        self.client = APIClient(HTTP_HOST='localhost')
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + issue(self.member).data['token'])
        self.turn = {'visitId': str(uuid4()), 'transcriptTurnId': str(uuid4())}

    def ask(self, question):
        return self.client.post(ASK, {**self.turn, 'question': question}, format='json')

    def test_risk_stops_before_tool_transcript_memory_or_audio(self):
        for route in ('refuse', 'explicit', 'self_harm', 'imminent_harm_others'):
            with self.subTest(route=route), patch('arti.llm.request_choice', return_value=reply(route, '숨길 문장')) as provider, patch(
                'arti.llm.execute_call', side_effect=AssertionError('unexpected lookup'),
            ) as tool, patch('arti.docent.docent_audio.sign_answer') as audio, patch('arti.docent.interest_signal') as memory:
                response = self.ask('소장처 기록과 별개로 사람을 위협하는 말을 써 주세요.')
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.json() | {'requestId': ''}, {
                    'answer': NOTICES[route], 'mode': 'refusal', 'safetyNotice': True, 'sourceRefs': [], 'requestId': '',
                })
                provider.assert_called_once()
                self.assertNotIn('tools', json.loads(provider.call_args.args[4]))
                tool.assert_not_called()
                audio.assert_not_called()
                memory.assert_not_called()
        self.assertFalse(DocentTranscript.objects.exists())

    def test_missing_decision_fails_before_lookup_and_native_refusal_has_fixed_text(self):
        native = {'finish_reason': 'stop', 'message': {'refusal': '모델 원문'}}
        with patch('arti.llm.request_choice', side_effect=[reply('unknown'), native]) as provider, patch('arti.llm.execute_call') as tool:
            self.assertEqual(self.ask('소장번호 질문').status_code, 502)
            result = self.ask('소장번호 질문')
            self.assertEqual(result.json()['answer'], NOTICES['refuse'])
            self.assertEqual(provider.call_count, 2)
            tool.assert_not_called()
        self.assertFalse(DocentTranscript.objects.exists())

    def test_timeout_and_same_turn_retry_preserve_grounded_answer_once(self):
        question = '상처를 그린 전쟁화에서 밝은 부분은 어디인가요?'
        display = '등록 자료에 있는 밝은 부분부터 살펴보세요.'
        safe = reply('answer', display, insufficientEvidence=False, collectionEvidenceUsed=False)
        with patch('arti.llm.request_choice', side_effect=[TimeoutError(), URLError(TimeoutError()), safe]) as provider:
            for _ in range(2):
                response = self.ask(question)
                self.assertEqual(response.status_code, 504)
                self.assertEqual(response.json()['code'], 'AI_TIMEOUT')
                self.assertIn('질문은 그대로', response.json()['error'])
                self.assertTrue(response.json()['retryable'])
                self.assertNotIn('audioGrant', response.json())
                self.assertFalse(DocentTranscript.objects.exists())
            result = self.ask(question).json()
            self.assertEqual(result['answer'], display)
            self.assertEqual(result['mode'], 'llm')
            self.assertIn('audioGrant', result)
            self.assertEqual(result['sourceRefs'][0]['artworkId'], 'fixture-art03')
        sent = [json.loads(json.loads(call.args[4])['messages'][1]['content'])['question']
                for call in provider.call_args_list]
        self.assertEqual(sent, [question] * 3)
        self.assertEqual(len(DocentTranscript.objects.get().turns), 1)
