"""Exercise the A-04 grounding review against a loopback provider."""
import json

from django.test import TestCase, override_settings

from arti.models import Artwork
from .test_integration import Helpers
from .test_provider import endpoint


L01 = ('파란 바탕의 왼쪽 위에 작은 노란 원이 있다. 오른쪽에는 넓은 흰 여백이 있고, '
       '아래쪽에는 가는 빨간 선이 가로로 놓여 있다.')
GUIDE = {
    'intro': '그림에서 색이 놓인 자리를 살펴봐요.',
    'questions': ['작은 노란 원은 어디에 있나요?'],
    'hints': ['파란 바탕의 왼쪽 위를 살펴보세요.'],
}


def completions(*answers):
    def respond(attempt):
        return 200, json.dumps({
            'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(answers[attempt-1])}}],
            'usage': {'prompt_tokens': 110, 'completion_tokens': 20},
        }).encode()
    return endpoint(respond=respond)


@override_settings(
    ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_DRAFT_GUIDE_REVIEW=True, ARTI_LUNA_DRAFT_VISION=True,
    ARTI_LLM_PROVIDER='openai_compatible', ARTI_LLM_MODELS={}, ARTI_DRAFT_PROVIDER='default',
    OPENAI_API_KEY='synthetic-review-only', OPENAI_MODEL='gpt-6-luna', ARTI_MODEL_SERVICE_URL='',
)
class GuideReviewTests(Helpers, TestCase):
    def setUp(self):
        self.setup_clients()
        self.work = Artwork.objects.get(pk='fixture-art01')
        source = self.put(self.work, description=L01)
        self.assertEqual(source.status_code, 200, source.content)
        self.work.refresh_from_db()
        response = self.put(
            self.work, reviewStatus='approved', guideIntro='확정 도입', guidedLooking=['확정 질문'],
            guidedHints=['확정 힌트'], guideStatus='confirmed',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.public_path = '/api/artworks/' + self.work.id
        self.baseline = self.public.get(self.public_path).json()

    def analyze(self, fields=None, **extras):
        self.work.refresh_from_db()
        return self.admin.post('/api/admin/artworks/' + self.work.id + '/analyze', {
            'version': self.work.version, 'regenerateFields': fields or ['guide'], **extras,
        }, format='json')

    def test_false_location_and_artist_intent_do_not_create_a_proposal(self):
        for candidate in (
            {**GUIDE, 'questions': ['오른쪽 위의 노란 원을 찾아볼까요?']},
            {**GUIDE, 'hints': ['작가는 고향을 떠올리려고 노란 원을 그렸어요.']},
            {**GUIDE, 'questions': ['작가는 빨간 선을 왜 그렸을까요?']},
        ):
            with self.subTest(candidate=candidate), completions(candidate, {'supported': False}) as requests:
                response = self.analyze()
                self.assertEqual(response.status_code, 502, response.content)
                self.assertEqual(response.json()['code'], 'GUIDE_UNSUPPORTED')
                self.assertIn('작품 자료에서 확인하지 못했어요', response.json()['error'])
                payload = requests[1]['body']
                self.assertIn('내포된 위치', payload['messages'][0]['content'])
                self.assertIn('작가 의도', payload['messages'][0]['content'])
                data = json.loads(payload['messages'][1]['content'])
                self.assertEqual(data['guideCandidate'], candidate)
                self.assertEqual(data['artworkData']['description'], L01)
                self.assertNotIn('guideIntro', data['artworkData'])
                self.assertEqual(self.public.get(self.public_path).json(), self.baseline)
                self.work.refresh_from_db()
                self.assertEqual(self.work.guide_status, 'confirmed')
                self.assertEqual(self.work.guided_looking, ['확정 질문'])
                self.assertEqual(self.work.retained_text, {})
                self.assertEqual(len(requests), 2)

    def test_malformed_review_fails_closed_and_supported_proposal_keeps_public_content(self):
        self.work.refresh_from_db()
        before = self.work.version
        with completions(GUIDE, {'supported': 'true'}):
            response = self.analyze()
            self.assertEqual(response.status_code, 502, response.content)
            self.assertEqual(response.json()['code'], 'PROVIDER_ERROR')
            self.work.refresh_from_db()
            self.assertEqual(self.work.version, before)
        with completions(GUIDE, {'supported': True}) as requests:
            response = self.analyze(useDraftImage=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['artwork']['guideStatus'], 'suggested')
        self.assertEqual(response.json()['artwork']['guidedLooking'], GUIDE['questions'])
        unchanged = {key: value for key, value in self.baseline.items() if key not in ('version', 'updatedAt')}
        public = self.public.get(self.public_path).json()
        self.assertEqual({key: public[key] for key in unchanged}, unchanged)
        generated, reviewed = [req['body']['messages'][1]['content'] for req in requests]
        self.assertEqual(generated[1], reviewed[1])
        self.assertEqual(reviewed[1]['type'], 'image_url')

    def test_rejected_guide_does_not_prevent_summary_and_review_usage_is_visible(self):
        with completions({'summary': '파란 바탕을 보세요.', 'keywords': ['파랑']},
                         GUIDE, {'supported': False}):
            response = self.analyze(['summary', 'guide'])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['summary']['made'])
        self.assertEqual(response.json()['guide']['code'], 'GUIDE_UNSUPPORTED')
        self.assertEqual(self.public.get(self.public_path).json()['guidedHints'], ['확정 힌트'])
        operations = self.admin.get('/api/admin/operations').json()
        event = next(row for row in operations['recent'] if row['requestId'] == response['X-Request-Id'])
        self.assertEqual(event['analysisFailures'], [{'field': 'guide', 'code': 'GUIDE_UNSUPPORTED'}])
        usage = next(row for row in operations['textModelUsageByTaskModel'] if row['task'] == 'guide_review')
        self.assertEqual((usage['attempts'], usage['inputTokens']), (1, 110))
