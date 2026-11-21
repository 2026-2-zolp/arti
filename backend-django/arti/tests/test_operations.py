import json
from datetime import datetime, timedelta, timezone
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings

from arti.http import ContractError
from arti.models import Artwork, OperationEvent, OperationTextModelUsage, OperationVoiceModelUsage
from arti.tests.test_integration import Helpers
from arti.tests.test_provider import endpoint


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_LLM_PROVIDER='disabled',
                   ARTI_DRAFT_PROVIDER='default', ARTI_MODEL_SERVICE_URL='')
class OperationsTests(Helpers, TestCase):
    def test_official_text_estimate_records_only_completely_measured_requests(self):
        self.setup_clients()
        answer = {'choices': [{'finish_reason': 'stop', 'message': {'content': '{"answer":"합성 응답"}'}}],
                  'usage': {'prompt_tokens': 100, 'completion_tokens': 40,
                            'prompt_tokens_details': {'cached_tokens': 20, 'cache_write_tokens': 10}}}
        incomplete = {**answer, 'usage': {'prompt_tokens': 100, 'completion_tokens': 40}}
        path = '/api/artworks/fixture-art03/ask'
        with (
            self.settings(ARTI_LLM_PROVIDER='openai_compatible', OPENAI_BASE_URL='https://api.openai.com/v1',
                          OPENAI_MODEL='gpt-6-luna', OPENAI_API_KEY='synthetic-price', ARTI_LLM_MODELS={}),
            patch('arti.llm.build_opener') as open_mock,
        ):
            upstream = open_mock.return_value.open.return_value.__enter__.return_value
            upstream.read.side_effect = [json.dumps(value).encode() for value in (answer, incomplete)]
            for _ in range(2):
                result = self.public.post(path, {'question': '어떻게 볼까요?', 'visitId': str(uuid4())}, format='json')
                self.assertEqual(result.status_code, 200, result.content)
        grouped = self.admin.get('/api/admin/operations').json()['textModelUsageByTaskModel']
        self.assertEqual(len(grouped), 1)
        self.assertEqual((grouped[0]['attempts'], grouped[0]['priced'], grouped[0]['estimatedCostUsd']), (
            2, 1, '0.000028450',
        ))

    def test_dashboard_uses_the_seoul_calendar_day_for_counts_and_token_groups(self):
        self.setup_clients()
        midnight = datetime(2026, 1, 1, 15, tzinfo=timezone.utc)
        for when, count in ((midnight - timedelta(seconds=1), 90), (midnight, 10), (midnight + timedelta(days=1), 80)):
            event = OperationEvent.objects.create(
                action='artwork_analysis', status=200, request_id=uuid4(), text_model_attempts=1,
                text_model_measured=1, text_model_input_tokens=count, text_model_output_tokens=1)
            OperationEvent.objects.filter(pk=event.pk).update(occurred_at=when)
            OperationTextModelUsage.objects.create(
                event=event, task='summary', model='fixture', attempts=1, measured=1,
                input_tokens=count, output_tokens=1, cache_measured=1, cached_input_tokens=0)
            voice = OperationEvent.objects.create(action='docent_audio', status=200, request_id=uuid4())
            OperationEvent.objects.filter(pk=voice.pk).update(occurred_at=when)
            OperationVoiceModelUsage.objects.create(
                event=voice, intent='play', model='fixture-voice', input_tokens=count, output_tokens=1)
        with patch('arti.operations.timezone.now', return_value=midnight + timedelta(hours=1)):
            report = self.admin.get('/api/admin/operations').json()
        self.assertEqual(report['today']['analysisRequests'], 1)
        self.assertEqual(report['textModelUsage']['inputTokens'], 10)
        self.assertEqual(report['textModelUsageByTaskModel'][0]['inputTokens'], 10)
        audio, = report['voiceModelUsageByIntent']
        self.assertEqual((audio['attempts'], audio['inputTokens'], audio['priced'], audio['estimatedCostUsd']), (1, 10, 0, None))

    def test_usage_export_is_half_open_and_marks_history_without_model_groups(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        end = start + timedelta(days=1)
        for when, count in ((start - timedelta(seconds=1), 8), (start, 2), (end, 8)):
            event = OperationEvent.objects.create(action='artwork_analysis', status=200, request_id=uuid4(),
                                                  text_model_attempts=count)
            OperationEvent.objects.filter(pk=event.pk).update(occurred_at=when)
            OperationTextModelUsage.objects.create(event=event, model='fixture', task='summary', attempts=1,
                                                   measured=1, input_tokens=count, output_tokens=1,
                                                   cache_measured=1, cached_input_tokens=0)
        output = StringIO()
        call_command('export_model_usage', '--project', 'fixture-project', '--start', '2026-01-01T09:00:00+09:00',
                     '--end', '2026-01-02T00:00:00Z', stdout=output)
        exported = json.loads(output.getvalue())
        self.assertEqual((exported['start'], exported['end']), (start.isoformat(), end.isoformat()))
        self.assertEqual(exported['ungroupedAttempts'], 1)
        self.assertEqual(exported['rows'], [{'model': 'fixture', 'task': 'summary', 'attempts': 1, 'missing': 0,
                                            'inputTokens': 2, 'outputTokens': 1, 'cachedInputTokens': 0,
                                            'cacheMissing': 0}])
        with self.assertRaisesMessage(CommandError, 'UTC offset'):
            call_command('export_model_usage', '--project', 'fixture', '--start', '2026-01-01',
                         '--end', '2026-01-02T00:00:00Z')

    def test_request_counts_and_model_usage_are_recorded_separately(self):
        self.setup_clients()
        operations = '/api/admin/operations?summary=1'
        self.assertEqual(self.admin.get(operations).json()['textModelUsage'], {
            'attempts': 0, 'missing': 0, 'inputTokens': None, 'outputTokens': None,
        })
        path = '/api/admin/artworks/fixture-art01/analyze'

        def respond(number):
            if number == 3:
                return 429, b'{}'
            content = ({'summary': '합성 요약', 'keywords': []} if number in (1, 4) else
                       {'intro': '합성 안내', 'questions': ['어떤 색인가요?'], 'hints': ['가운데를 보세요.']})
            usage = {1: {'prompt_tokens': 120, 'completion_tokens': 30, 'prompt_tokens_details': {'cached_tokens': 0}},
                     2: {'prompt_tokens': True, 'completion_tokens': 10},
                     4: {'prompt_tokens': 200, 'completion_tokens': 40, 'prompt_tokens_details': {'cached_tokens': 80}}}[number]
            response = {'model': 'provider-private-metadata',
                        'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(content)}}], 'usage': usage}
            return 200, json.dumps(response).encode()

        with endpoint(respond=respond) as requests:
            with self.settings(ARTI_DRAFT_PROVIDER='openai_compatible', ARTI_DRAFT_BASE_URL=settings.OPENAI_BASE_URL,
                               ARTI_DRAFT_MODEL='synthetic-usage', ARTI_DRAFT_API_KEY='synthetic-test-only'):
                work = Artwork.objects.get(pk='fixture-art01')
                result = self.admin.post(path, {'version': work.version, 'regenerateFields': ['summary', 'guide']}, format='json')
                self.assertEqual(result.status_code, 200, result.content)
                again = self.admin.post(path, {'version': result.json()['artwork']['version'],
                                               'regenerateFields': ['guide']}, format='json')
                self.assertEqual(again.status_code, 429, again.content)
                with self.settings(ARTI_DRAFT_MODEL='synthetic-alternate'):
                    alternate = self.admin.post(path, {'version': result.json()['artwork']['version'],
                                                       'regenerateFields': ['summary']}, format='json')
                    self.assertEqual(alternate.status_code, 200, alternate.content)
        self.assertEqual(len(requests), 4)
        report = self.admin.get(operations).json()
        self.assertEqual(report['today']['analysisRequests'], 3)
        self.assertEqual(report['textModelUsage'], {
            'attempts': 4, 'missing': 2, 'inputTokens': 320, 'outputTokens': 70,
        })
        self.assertNotIn('textModelUsageByTaskModel', report)
        groups = self.admin.get('/api/admin/operations?errors=1').json()['textModelUsageByTaskModel']
        self.assertEqual(groups, [
            {'task': 'guide', 'model': 'synthetic-usage', 'attempts': 2, 'missing': 2,
             'inputTokens': None, 'outputTokens': None, 'cachedInputTokens': None, 'cacheMissing': 2},
            {'task': 'summary', 'model': 'synthetic-alternate', 'attempts': 1, 'missing': 0,
             'inputTokens': 200, 'outputTokens': 40, 'cachedInputTokens': 80, 'cacheMissing': 0},
            {'task': 'summary', 'model': 'synthetic-usage', 'attempts': 1, 'missing': 0,
             'inputTokens': 120, 'outputTokens': 30, 'cachedInputTokens': 0, 'cacheMissing': 0},
        ])

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
