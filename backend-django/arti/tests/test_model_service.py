# Django와 분석 서비스 간 실제 HTTP 계약·실패 격리·이미지 경계를 검증합니다.
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
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
