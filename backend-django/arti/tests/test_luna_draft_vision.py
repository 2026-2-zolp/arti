"""Administrator draft image isolation using the loopback Chat Completions fixture."""
import base64
import json
from pathlib import Path

from django.conf import settings
from django.test import TestCase, override_settings

from arti.llm import MAX_DRAFT_IMAGE
from arti.models import Artwork
from .test_integration import Helpers
from .test_provider import endpoint


@override_settings(
    ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_LUNA_DRAFT_VISION=True,
    ARTI_DRAFT_PROVIDER='default', ARTI_LLM_PROVIDER='openai_compatible',
    OPENAI_API_KEY='synthetic-luna-test-key', OPENAI_MODEL='gpt-6-luna', ARTI_LLM_MODELS={},
    ARTI_MODEL_SERVICE_URL='',
)
class LunaDraftVisionTests(Helpers, TestCase):
    def setUp(self):
        self.setup_clients()
        self.work = Artwork.objects.get(pk='fixture-art01')

    def analyze(self, fields, **extras):
        self.work.refresh_from_db()
        return self.admin.post(f'/api/admin/artworks/{self.work.id}/analyze', {
            'version': self.work.version, 'regenerateFields': fields, **extras,
        }, format='json')

    def test_opt_in_sends_only_uploaded_bytes_to_admin_summary_and_guide(self):
        summary = {'summary': '밝은 사각형을 볼 수 있어요.', 'keywords': ['사각형']}
        guide = {'intro': '모양부터 찾아봐요.', 'questions': ['가장 밝은 곳은 어디예요?'], 'hints': ['가운데를 살펴보세요.']}
        answers = [summary, summary, guide, {**guide, 'hints': []}, {'answer': '밝은 곳을 다시 볼까요?'}]

        def respond(attempt):
            return 200, json.dumps({'choices': [{'finish_reason': 'stop',
                              'message': {'content': json.dumps(answers[attempt - 1])}}]}).encode()

        public_path = f'/api/artworks/{self.work.id}'
        confirmed = self.put(self.work, summary='공개 요약', summaryKeywords=['공개'], summaryStatus='confirmed',
                             guideIntro='공개 도입', guidedLooking=['공개 질문'], guidedHints=['공개 힌트'],
                             guideStatus='confirmed')
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        approved = self.public.get(public_path).json()
        with endpoint(respond=respond) as requests:
            report = self.admin.get('/api/admin/operations?summary=1').json()
            self.assertEqual(report['draftImageTasks'], ['summary', 'guide'])
            for fields in ([], ['tag'], ['summary', 'emotion']):
                self.assertEqual(self.analyze(fields, useDraftImage=True).status_code, 400)
            self.assertEqual(len(requests), 0)
            for fields, opt_in in [(['summary'], False), (['summary'], True), (['guide'], True)]:
                response = self.analyze(fields, useDraftImage=opt_in)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()['artwork'][f'{fields[0]}Status'], 'suggested')
            self.work.refresh_from_db()
            version = self.work.version
            before_failure = self.public.get(public_path).json()
            for field in ('summary', 'summaryKeywords', 'summaryStatus', 'summaryRevision', 'guideIntro',
                          'guidedLooking', 'guidedHints', 'guideStatus', 'guideRevision'):
                self.assertEqual(before_failure[field], approved[field], field)
            malformed = self.analyze(['guide'], useDraftImage=True)
            self.assertEqual(malformed.status_code, 502, malformed.content)
            self.work.refresh_from_db()
            self.assertEqual(self.work.version, version)
            self.assertEqual(self.public.get(public_path).json(), before_failure)
            answer = self.public.post(public_path + '/ask', {
                'question': '가장 밝은 곳은 어디예요?', 'useDraftImage': True,
            }, format='json')
            self.assertEqual(answer.status_code, 200, answer.content)

        self.assertEqual(len(requests), 5)
        self.assertTrue(all(request['body']['model'] == 'gpt-6-luna' for request in requests))
        contents = [request['body']['messages'][1]['content'] for request in requests]
        self.assertIsInstance(contents[0], str)
        self.assertIsInstance(contents[4], str)
        original = (Path(settings.MEDIA_ROOT) / self.work.image_file).read_bytes()
        for content in contents[1:4]:
            self.assertEqual([part['type'] for part in content], ['text', 'image_url'])
            prefix, encoded = content[1]['image_url']['url'].split(',', 1)
            self.assertEqual(prefix, 'data:image/png;base64')
            self.assertEqual(base64.b64decode(encoded), original)

    def test_disabled_route_and_invalid_files_do_not_reach_provider(self):
        with endpoint() as requests:
            with self.settings(ARTI_LUNA_DRAFT_VISION=False):
                self.assertEqual(self.analyze(['summary'], useDraftImage=True).status_code, 400)
            with self.settings(OPENAI_MODEL='other-model'):
                self.assertEqual(self.analyze(['summary'], useDraftImage=True).status_code, 400)
            path = Path(settings.MEDIA_ROOT) / self.work.image_file
            path.write_bytes(b'a' * (MAX_DRAFT_IMAGE + 1))
            self.assertEqual(self.analyze(['summary'], useDraftImage=True).status_code, 413)
            path.write_bytes(b'unknown format')
            self.assertEqual(self.analyze(['guide'], useDraftImage=True).status_code, 415)
            self.assertEqual(requests, [])
