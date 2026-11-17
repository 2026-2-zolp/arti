from unittest.mock import patch

from django.test import TestCase, override_settings

from arti.http import ContractError
from arti.models import Artwork
from arti.tests.test_integration import Helpers


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_LLM_PROVIDER='disabled',
                   ARTI_DRAFT_PROVIDER='default', ARTI_MODEL_SERVICE_URL='')
class OperationsTests(Helpers, TestCase):
    def test_partial_analysis_filter_and_counts_exclude_disabled_fields_and_request_content(self):
        self.setup_clients()
        path = '/api/admin/artworks/fixture-art01/analyze'

        def submit():
            work = Artwork.objects.get(pk='fixture-art01')
            return self.admin.post(path, {'version': work.version, 'regenerateFields': ['summary', 'guide', 'tag', 'emotion']}, format='json')

        def generate(kind, *_args, **_kwargs):
            if kind == 'summary':
                return {'summary': '새로운 비공개 합성 문안', 'keywords': []}
            if kind == 'guide':
                raise ContractError(502, 'PROVIDER_ERROR', '로그에 남기지 않는 합성 세부 정보')
            if kind == 'emotion':
                raise ContractError(504, 'AI_TIMEOUT', '로그에 남기지 않는 합성 세부 정보')
            raise ContractError(503, 'AI_UNAVAILABLE', '시험에서 꺼진 집계 항목')

        with patch('arti.providers.generate', side_effect=generate):
            result = submit()
        self.assertEqual(result.status_code, 200, result.content)
        self.assertTrue(result.json()['summary']['made'])
        self.assertEqual(result.json()['tag']['code'], 'AI_UNAVAILABLE')
        report = self.admin.get('/api/admin/operations?errors=1').json()
        self.assertEqual(report['today']['analysisPartialFailures'], 1)
        self.assertEqual(report['today']['aiErrors'], 0)
        self.assertEqual(report['today']['analysisRequests'], 1)
        entry, = report['recent']
        self.assertEqual(entry['requestId'], result.headers['X-Request-Id'])
        self.assertEqual(entry['status'], 200)
        self.assertEqual(entry['analysisFailures'], [{'field': 'guide', 'code': 'PROVIDER_ERROR'},
                                                    {'field': 'emotion', 'code': 'AI_TIMEOUT'}])
        self.assertNotIn('합성', str(entry))

        def with_disabled(kind, *_args, **_kwargs):
            if kind == 'summary':
                return {'summary': '다른 합성 문안', 'keywords': []}
            raise ContractError(503, 'AI_UNAVAILABLE', '설정상 꺼짐')

        with patch('arti.providers.generate', side_effect=with_disabled):
            ignored = submit()
        self.assertEqual(ignored.status_code, 200)
        report = self.admin.get('/api/admin/operations?errors=1').json()
        self.assertEqual(report['today']['analysisPartialFailures'], 1)
        self.assertEqual(report['today']['analysisRequests'], 2)
        self.assertEqual(len(report['recent']), 1)
