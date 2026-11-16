# Django와 분석 서비스 간 실제 HTTP 계약·실패 격리·이미지 경계를 검증합니다.
import base64
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from django.conf import settings
from django.test import SimpleTestCase, override_settings
from arti import providers
from arti.constants import TAGS, EMOTIONS
from arti.http import ContractError
from arti.tests.test_provider import endpoint


def result():
    return dict(tags={k: .5 for k in TAGS}, emotions={k: .5 for k in EMOTIONS},
                models={'image': 'clip-test', 'text': 'nli-test'}, usedImage=True,
                usedText=True, imageError=None, tagSource='image')


class ModelServiceTests(SimpleTestCase):
    def test_image_wire_and_single_analysis_for_two_outputs(self):
        with tempfile.TemporaryDirectory() as tmp, endpoint(body=json.dumps(result()).encode()) as requests:
            Path(tmp, 'test.png').write_bytes(b'synthetic-image')
            from django.conf import settings
            with override_settings(MEDIA_ROOT=Path(tmp), ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                cache = {}
                snapshot = {'title': '합성', 'description': '원문', 'imageFile': 'test.png', 'summary': 'UNREVIEWED'}
                tag = providers.generate('tag', snapshot, analysis_cache=cache)
                emotion = providers.generate('emotion', snapshot, analysis_cache=cache)
            self.assertEqual(len(requests), 1)
            self.assertEqual(requests[0]['path'], '/analyze')
            self.assertEqual(set(requests[0]['body']), {'title', 'description', 'imageBase64'})
            self.assertEqual(tag['scores'], result()['tags'])
            self.assertEqual(emotion['models']['image'], 'clip-test')

    def test_invalid_scores_and_image_fallback_rejected(self):
        variants = []
        for field in ['tags', 'emotions']:
            v = result(); v[field] = {}; variants.append(v)
            v = result(); v[field][next(iter(v[field]))] = float('nan'); variants.append(v)
        v = result(); v['usedImage'] = False; variants.append(v)
        v = result(); v['imageError'] = 'decode failed'; variants.append(v)
        v = result(); v['tagSource'] = 'text'; variants.append(v)
        for value in variants:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as tmp, endpoint(body=json.dumps(value).encode()):
                from django.conf import settings
                Path(tmp, 'test.png').write_bytes(b'x')
                with override_settings(MEDIA_ROOT=Path(tmp), ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                    with self.assertRaises(ContractError):
                        providers.generate('tag', {'imageFile': 'test.png'})

    @override_settings(ARTI_MODEL_SERVICE_URL='http://localhost:8001')
    def test_no_external_fetch_or_path_escape(self):
        for snapshot in [{'imageFile': '../outside.png'}, {'imageUrl': 'http://169.254.169.254/'}]:
            with self.subTest(snapshot=snapshot), patch('arti.model_service.build_opener') as opener:
                with self.assertRaises(ContractError): providers.generate('tag', snapshot)
                opener.assert_not_called()

    def test_http_failure_and_redirect_do_not_return_scores(self):
        for status in [302, 503, 500]:
            with self.subTest(status=status), endpoint(status=status) as requests:
                from django.conf import settings
                with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                    with self.assertRaises(ContractError): providers.generate('emotion', {'description': '원문'})
                self.assertEqual(len(requests), 1)

    @override_settings(ARTI_MODEL_SERVICE_URL='http://localhost:8001')
    def test_timeout_and_large_response_fail_closed(self):
        from arti.model_service import MAX_RESPONSE
        with patch('arti.model_service.build_opener') as opener:
            opener.return_value.open.side_effect = TimeoutError()
            with self.assertRaises(ContractError) as exc:
                providers.generate('tag', {'description': '원문'})
            self.assertEqual(exc.exception.status_code, 504)
        with endpoint(body=b'x' * (MAX_RESPONSE + 1)):
            from django.conf import settings
            with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                with self.assertRaises(ContractError):
                    providers.generate('tag', {'description': '원문'})

    @override_settings(ARTI_MODEL_SERVICE_URL='http://localhost:8001')
    def test_truncated_http_transport_is_sanitized(self):
        from http.client import IncompleteRead
        with patch('arti.model_service.build_opener') as opener:
            opener.return_value.open.side_effect=IncompleteRead(b'synthetic partial body')
            with self.assertRaises(ContractError) as exc:
                providers.generate('tag', {'description':'원문'})
            self.assertEqual(exc.exception.status_code,502)
            self.assertNotIn('synthetic partial body',str(exc.exception))

    @override_settings(ARTI_MODEL_SERVICE_URL='')
    def test_disabled_independent_of_gpt(self):
        with self.assertRaises(ContractError) as exc: providers.generate('tag', {})
        self.assertEqual(exc.exception.status_code, 503)

# 실제 PostgreSQL/API 저장 경계는 공급자 함수를 모킹하지 않고 로컬 HTTP로 확인합니다.
from django.test import TestCase
from arti.tests.test_integration import Helpers
from arti.models import Artwork


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_LLM_PROVIDER='disabled')
class ModelStorageTests(Helpers, TestCase):
    def setUp(self):
        self.setup_clients()
        self.work = Artwork.objects.get(pk='fixture-art01')
        self.work.image_url = ''
        self.work.image_file = None
        self.work.tag_status = 'none'
        self.work.emotion_status = 'none'
        self.work.save()

    def test_scores_stored_as_suggestions_without_approval(self):
        value = result()
        value.update(usedImage=False, tagSource='text')
        with endpoint(body=json.dumps(value).encode()) as requests:
            from django.conf import settings
            with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                r = self.admin.post('/api/admin/artworks/fixture-art01/analyze', {'version': self.work.version}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(requests), 1)
        self.work.refresh_from_db()
        self.assertEqual(self.work.tag_status, 'suggested')
        self.assertEqual(self.work.emotion_status, 'suggested')
        self.assertEqual(self.work.tag_scores, value['tags'])
        self.assertEqual(self.work.analysis['emotions'], value['emotions'])

    def test_failure_preserves_values_and_version(self):
        before = (self.work.version, self.work.tag_scores, self.work.analysis)
        with endpoint(status=503):
            from django.conf import settings
            with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                r = self.admin.post('/api/admin/artworks/fixture-art01/analyze', {'version': self.work.version}, format='json')
        self.assertEqual(r.status_code, 503, r.content)
        self.work.refresh_from_db()
        self.assertEqual((self.work.version, self.work.tag_scores, self.work.analysis), before)

    def test_admin_analysis_sends_image_only_when_selected_and_keeps_text_prompts(self):
        self.work.image_file = 'fixture-public.png'
        self.work.summary_status = self.work.guide_status = 'suggested'
        self.work.save()
        approved_text = {'title': self.work.title, 'description': self.work.description}
        text_replies = {'summary-test': {'summary': '합성 요약', 'keywords': ['빛']},
                        'guide-test': {'intro': '합성 도입', 'questions': ['어떤 빛인가요?'], 'hints': ['밝기를 보세요.']}}

        def respond(attempt):
            request = requests[attempt - 1]
            if request['path'] == '/analyze':
                used_image = 'imageBase64' in request['body']
                value = result() | {'usedImage': used_image, 'tagSource': 'image' if used_image else 'text'}
            else:
                value = {'choices': [{'finish_reason': 'stop', 'message': {
                    'content': json.dumps(text_replies[request['body']['model']]),
                }}]}
            return 200, json.dumps(value).encode()

        with endpoint(respond=respond) as requests, override_settings(
            ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1'),
            ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-only',
            ARTI_LLM_MODELS={'summary': 'summary-test', 'guide': 'guide-test'},
        ):
            for index, (option, used_image) in enumerate((({}, True), ({'useImage': False}, False), ({'useImage': True}, True))):
                with self.subTest(option=option):
                    self.work.refresh_from_db()
                    response = self.admin.post(f'/api/admin/artworks/{self.work.id}/analyze', {
                        'version': self.work.version, **option,
                    }, format='json')
                    self.assertEqual(response.status_code, 200, response.content)
                    artwork = response.json()['artwork']
                    self.assertIs(artwork['analysis']['usedImage'], used_image)
                    self.assertEqual(artwork['imageFile'], 'fixture-public.png')
                    self.assertEqual(artwork['sourceVersion'], self.work.source_version)
                    self.assertEqual(artwork['version'], self.work.version + 1)
                    self.assertEqual(len(requests), (index + 1) * 3)
                    summary_call, guide_call, model_call = requests[index * 3:]
                    self.assertEqual(summary_call['path'], '/v1/chat/completions')
                    self.assertEqual(guide_call['path'], '/v1/chat/completions')
                    self.assertEqual(model_call['path'], '/analyze')
                    model_data = model_call['body'].copy()
                    self.assertEqual('imageBase64' in model_data, used_image)
                    if used_image:
                        self.assertEqual(base64.b64decode(model_data.pop('imageBase64')),
                                         (settings.MEDIA_ROOT / 'fixture-public.png').read_bytes())
                    self.assertEqual(model_data, approved_text)
                    if index:
                        self.assertEqual(summary_call['body'], requests[0]['body'])
                        self.assertEqual(guide_call['body'], requests[1]['body'])

    def test_admin_text_only_mode_skips_missing_file_and_external_url(self):
        value = result() | {'usedImage': False, 'tagSource': 'text'}
        with endpoint(body=json.dumps(value).encode()) as requests, override_settings(
            ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1'),
        ):
            for image_file, image_url in [('nonexistent-test.png', ''), (None, 'https://synthetic.invalid/source.png')]:
                with self.subTest(image_file=image_file, image_url=image_url):
                    self.work.image_file, self.work.image_url = image_file, image_url
                    self.work.save(update_fields=['image_file', 'image_url'])
                    response = self.admin.post(f'/api/admin/artworks/{self.work.id}/analyze', {
                        'version': self.work.version, 'useImage': False,
                    }, format='json')
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(requests[-1]['body'], {'title': self.work.title, 'description': self.work.description})
                    self.work.refresh_from_db()
        self.assertEqual(len(requests), 2)

    def test_admin_text_only_mode_rejects_provider_image_claim(self):
        version = self.work.version
        for claim in ({'usedImage': True, 'tagSource': 'text'}, {'usedImage': False, 'tagSource': 'image'}):
            with self.subTest(claim=claim), endpoint(body=json.dumps(result() | claim).encode()) as requests, override_settings(
                ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1'),
            ):
                response = self.admin.post(f'/api/admin/artworks/{self.work.id}/analyze', {
                    'version': version, 'useImage': False,
                }, format='json')
                self.assertEqual(response.status_code, 502, response.content)
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0]['body'], {'title': self.work.title, 'description': self.work.description})
                self.work.refresh_from_db()
                self.assertEqual(self.work.version, version)
                self.assertIsNone(self.work.analysis)

    def test_admin_analysis_rejects_nonboolean_image_option_before_provider(self):
        with patch('arti.providers.generate') as generate:
            for value in (None, 1, 'false', []):
                with self.subTest(option=value):
                    response = self.admin.post(f'/api/admin/artworks/{self.work.id}/analyze', {
                        'version': self.work.version, 'useImage': value,
                    }, format='json')
                    self.assertEqual(response.status_code, 400, response.content)
        generate.assert_not_called()
