import base64
import hashlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import wave
from unittest.mock import ANY, patch
from uuid import uuid4

from django.core.cache import cache
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from arti import docent_audio
from arti.http import ContractError
from arti.member import issue
from arti.models import Account, Artwork, OperationVoiceModelUsage, Visit


REPLY = '노란 원과 밝은 면을 차례로 보세요.'
WORK = 'fixture-art03'
ASK = f'/api/artworks/{WORK}/ask'
AUDIO = f'/api/artworks/{WORK}/answer-audio'


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, OPENAI_API_KEY='synthetic-voice',
                   OPENAI_BASE_URL='https://api.openai.com/v1', ARTI_DOCENT_AUDIO_EXHIBITIONS={'fixture-ex01'})
class DocentAudioContractTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('load_test_fixture', stdout=io.StringIO())

    def setUp(self):
        cache.clear()
        self.visit_id = str(uuid4())
        self.client = APIClient(HTTP_HOST='localhost')

    def ask(self):
        with patch('arti.docent.providers.generate', return_value={'answer': REPLY}):
            response = self.client.post(ASK, {'question': '어디를 볼까요?', 'visitId': self.visit_id}, format='json')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def payload(self):
        return {'answer': REPLY, 'audioGrant': self.ask()['audioGrant'], 'visitId': self.visit_id}

    @override_settings(ARTI_ENV='production', ALLOW_TEST_FIXTURES=False,
                       ARTI_DOCENT_LISTENING_EXHIBITIONS={'fixture-ex01'})
    def test_production_uses_opt_in_play_only(self):
        payload = self.payload()
        self.assertNotIn('docentListeningAvailable', self.client.get(f'/api/artworks/{WORK}').json())
        with patch('arti.docent_audio.synthesize', return_value=b'RIFFVOICE') as render:
            self.assertEqual(self.client.post(AUDIO, {**payload, 'intent': 'prepare'}, format='json').status_code, 404)
            render.assert_not_called()
            self.assertEqual(self.client.post(AUDIO, payload, format='json').status_code, 200)
            render.assert_called_once()
        with override_settings(ARTI_DOCENT_AUDIO_EXHIBITIONS=set()):
            self.assertNotIn('audioGrant', self.ask())
            self.assertEqual(self.client.post(AUDIO, payload, format='json').status_code, 404)

    @override_settings(ARTI_ENV='production', ALLOW_TEST_FIXTURES=False, OPENAI_API_KEY='')
    def test_prerecorded_audio_requires_matching_public_text(self):
        work = Artwork.objects.get(pk=WORK)
        digest = hashlib.sha256(work.description.strip().encode()).hexdigest()
        request = f'/api/artworks/{WORK}/narration/description?v={digest}'
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            media = Path(directory) / 'narration'
            media.mkdir()
            file = f'{WORK}-description-0123456789abcdef.mp3'
            (media / file).write_bytes(b'mock-mp3')
            entry = {'artworkId': WORK, 'kind': 'description', 'voice': 'marin',
                     'textSha256': digest, 'providerTranscriptMatched': True, 'file': file}
            (media / f'{WORK}-description.json').write_text(json.dumps(entry), encoding='utf-8')
            self.assertEqual(self.client.get(f'/api/artworks/{WORK}').json()['narrationVersions'], {'description': digest})
            response = self.client.get(request)
            self.assertEqual(response.headers['Content-Type'], 'audio/mpeg')
            self.assertEqual(b''.join(response.streaming_content), b'mock-mp3')
            self.assertEqual(self.client.get(request.replace(digest, 'other')).status_code, 404)
            with override_settings(ARTI_DOCENT_AUDIO_EXHIBITIONS=set()):
                self.assertEqual(self.client.get(request).status_code, 404)
            Artwork.objects.filter(pk=WORK).update(description='문안이 바뀌었어요.')
            self.assertEqual(self.client.get(request).status_code, 404)
            Artwork.objects.filter(pk=WORK).update(description=work.description, review_status='source_check')
            self.assertEqual(self.client.get(request).status_code, 404)

    def test_only_current_answer_and_visit_can_start_synthesis(self):
        with patch('arti.docent_audio.synthesize', return_value=b'RIFFVOICE') as render:
            payload = self.payload()
            render.assert_not_called()
            for change in ({'answer': '다른 문장'}, {'visitId': str(uuid4())}, {'audioGrant': 'forged'}):
                self.assertEqual(self.client.post(AUDIO, {**payload, **change}, format='json').status_code, 409)
            render.assert_not_called()
            response = self.client.post(AUDIO, payload, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Content-Type'], 'audio/wav')
            self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
            self.assertEqual(response.content, b'RIFFVOICE')
            render.assert_called_once_with(REPLY, on_done=ANY)
        self.assertFalse(Visit.objects.exists())

    def test_session_and_approved_version_are_checked(self):
        member = Account.objects.create(role='user', login_id='voice@example.test', email='voice@example.test')
        token = issue(member).data['token']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        payload = self.payload()
        with patch('arti.docent_audio.synthesize') as render:
            self.client.credentials()
            self.assertEqual(self.client.post(AUDIO, payload, format='json').status_code, 409)
            self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            work = Artwork.objects.get(pk=WORK)
            Artwork.objects.filter(pk=WORK).update(content_version=work.content_version + 1)
            self.assertEqual(self.client.post(AUDIO, payload, format='json').status_code, 409)
            render.assert_not_called()

    def test_prepare_is_restricted_to_the_listening_exhibition(self):
        payload = self.payload()
        public = self.client.get(f'/api/artworks/{WORK}').json()
        self.assertNotIn('docentListeningAvailable', public)
        with patch('arti.docent_audio.metered_synthesize', return_value=b'RIFFVOICE') as render:
            response = self.client.post(AUDIO, {**payload, 'intent': 'prepare'}, format='json')
            self.assertEqual(response.status_code, 404)
            render.assert_not_called()
            with override_settings(ARTI_DOCENT_LISTENING_EXHIBITIONS={'fixture-ex01'}):
                self.assertTrue(self.client.get(f'/api/artworks/{WORK}').json()['docentListeningAvailable'])
                refused = self.client.post(AUDIO, {**payload, 'intent': 'prepare', 'answer': '변조'}, format='json')
                self.assertEqual(refused.status_code, 409)
                response = self.client.post(AUDIO, {**payload, 'intent': 'prepare'}, format='json')
                self.assertEqual(response.status_code, 200)
                render.assert_called_once_with(REPLY, request_id=response.headers['X-Request-Id'], intent='prepare')

    @override_settings(ARTI_DOCENT_LISTENING_EXHIBITIONS={'fixture-ex01'})
    def test_admin_counts_voice_attempts_and_estimates_without_recording_content(self):
        payload = self.payload()
        forbidden = self.client.post(AUDIO, {**payload, 'audioGrant': 'forged'}, format='json')
        self.assertEqual(forbidden.status_code, 409)
        self.assertFalse(OperationVoiceModelUsage.objects.exists())

        def measured(_reply, *, on_done):
            on_done({'usage': {
                'input_token_details': {'text_tokens': 100, 'audio_tokens': 0, 'cached_tokens': 64,
                                        'cached_tokens_details': {'text_tokens': 64}},
                'output_token_details': {'text_tokens': 45, 'audio_tokens': 48},
            }, 'transcript': REPLY})
            return b'RIFFVOICE'

        def rejected(reply, *, on_done):
            measured(reply, on_done=on_done)
            raise docent_audio.provider_error()

        with patch('arti.docent_audio.synthesize', side_effect=measured):
            played = self.client.post(AUDIO, payload, format='json')
        with patch('arti.docent_audio.synthesize', side_effect=rejected):
            rejected_prepare = self.client.post(AUDIO, {**payload, 'intent': 'prepare'}, format='json')
        with patch('arti.docent_audio.synthesize', side_effect=ContractError(504, 'AI_TIMEOUT', '합성 오류')):
            timed_out = self.client.post(AUDIO, {**payload, 'intent': 'prepare'}, format='json')
        self.assertEqual([played.status_code, rejected_prepare.status_code, timed_out.status_code], [200, 502, 504])
        self.assertEqual(OperationVoiceModelUsage.objects.count(), 3)

        report_path = '/api/admin/operations'
        self.assertIn(self.client.get(report_path).status_code, (401, 403))
        operator = Account.objects.create(role='admin', login_id='voice-operator')
        self.client.credentials(HTTP_X_ADMIN_TOKEN=issue(operator).data['token'])
        response = self.client.get(report_path)
        self.assertEqual(response.status_code, 200)
        report = response.json()
        common = {'model': docent_audio.MODEL, 'measured': 1, 'priced': 1, 'inputTokens': 100,
                  'cachedInputTokens': 64, 'outputTokens': 93, 'outputAudioTokens': 48,
                  'estimatedCostUsd': '0.001093440'}
        self.assertEqual(report['voiceModelUsageByIntent'], [
            {**common, 'intent': 'play', 'attempts': 1},
            {**common, 'intent': 'prepare', 'attempts': 2},
        ])
        self.assertEqual(report['textModelUsage'], {'attempts': 0, 'missing': 0, 'inputTokens': None, 'outputTokens': None})
        self.assertNotIn('voiceModelUsageByIntent', self.client.get(report_path + '?summary=1').json())
        self.assertNotIn(REPLY, response.content.decode())
        self.assertNotIn(payload['audioGrant'], response.content.decode())

    @override_settings(ARTI_ENV='production', ARTI_DOCENT_AUDIO_EXHIBITIONS=set())
    def test_production_does_not_issue_grants_or_expose_rendering(self):
        self.assertNotIn('audioGrant', self.ask())
        with patch('arti.docent_audio.synthesize') as render:
            self.assertEqual(self.client.post(AUDIO, {}, format='json').status_code, 404)
            render.assert_not_called()


@override_settings(OPENAI_API_KEY='synthetic-voice')
class DocentVoiceFramesTests(SimpleTestCase):
    def test_trial_logs_numeric_usage_even_when_audio_is_rejected(self):
        def reject(reply, *, on_done):
            on_done({'usage': {
                'input_token_details': {'text_tokens': 45, 'audio_tokens': 0, 'cached_tokens': 12,
                                        'cached_tokens_details': {'text_tokens': 12}},
                'output_token_details': {'text_tokens': 7, 'audio_tokens': 30, 'text': reply},
            }, 'transcript': reply})
            raise docent_audio.provider_error()

        with patch('arti.docent_audio.synthesize', side_effect=reject), self.assertLogs('arti.docent_audio.trial') as log:
            with self.assertRaises(ContractError):
                docent_audio.metered_synthesize(REPLY, request_id='request-probe', intent='prepare')
        record = json.loads(log.output[0].split('arti_voice_trial ', 1)[1])
        self.assertEqual(record['outcome'], 'failed')
        self.assertEqual(record['tokens'], {'inputText': 45, 'inputAudio': 0, 'inputImage': 0,
                                            'cachedInput': 12, 'cachedText': 12, 'outputText': 7, 'outputAudio': 30})
        self.assertNotIn(REPLY, log.output[0])

    def test_returns_wav_from_marin_only_when_transcript_matches(self):
        for transcript in ('노란 원과 밝은 면을 차례로 보세요', '노란 원과 어두운 면을 보세요'):
            with self.subTest(transcript=transcript), patch('websockets.sync.client.connect') as connect:
                socket = connect.return_value.__enter__.return_value
                socket.recv.side_effect = [json.dumps(frame) for frame in (
                    {'type': 'response.output_audio.delta', 'delta': base64.b64encode(b'\x01\x00').decode()},
                    {'type': 'response.output_audio_transcript.done', 'transcript': transcript},
                    {'type': 'response.done', 'response': {'status': 'completed'}},
                )]
                if transcript.endswith('차례로 보세요'):
                    with wave.open(io.BytesIO(docent_audio.synthesize(REPLY))) as clip:
                        self.assertEqual((clip.getframerate(), clip.getnchannels()), (24000, 1))
                        self.assertEqual(clip.readframes(1), b'\x01\x00')
                else:
                    with self.assertRaises(ContractError):
                        docent_audio.synthesize(REPLY)
                payload = json.loads(socket.send.call_args.args[0])['response']
                self.assertEqual(payload['audio']['output']['voice'], 'marin')
                self.assertEqual(payload['conversation'], 'none')
                self.assertEqual(payload['input'][0]['content'], [{'type': 'input_text', 'text': REPLY}])
