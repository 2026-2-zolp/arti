"""Exercise a synthetic PostgreSQL transcript contract without registering an application route."""

import io
import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from unittest.mock import patch
from uuid import uuid4

from django.core import signing
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.urls import include, path
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework.test import APIClient

from arti.docent_memory import memory_demo_enabled
from arti.http import ContractError
from arti.member import issue, member
from arti.models import Account, Artwork, Session, Visit
from arti.tests.docent_browser_server import ensure_visitor_memory_fixture
from arti.tests.test_provider import endpoint


SALT = 'arti.synthetic.transcript-trial.v1'
OWNER_SCOPE = 'owner_id = %s AND exhibition_id = %s AND artwork_id = %s AND visit_id = %s AND turn_id = %s'
PRIVATE_HEADERS = {'Cache-Control': 'private, no-store'}
SOURCE = 'fixture-ex01'
TARGET = 'fixture-ex-memory'
SOURCE_WORK = 'fixture-art03'
TARGET_WORK = 'fixture-memory-art01'


def raw_fingerprint(question, answer):
    return sha256(json.dumps([question, answer], ensure_ascii=False).encode()).hexdigest()


@api_view(['GET', 'POST', 'DELETE'])
def transcript_probe(request, exhibition_id, artwork_id, visit_id, turn_id):
    if not memory_demo_enabled(exhibition_id) or not Artwork.objects.filter(
            pk=artwork_id, exhibition_id=exhibition_id).exists():
        raise ContractError(404, 'NOT_FOUND', '합성 검수 범위에 이 작품이 없어요.')
    actor = member(request)
    scope = [actor.pk, exhibition_id, artwork_id, str(visit_id), str(turn_id)]
    now = timezone.now()
    if request.method == 'POST':
        body = request.data
        if not isinstance(body, dict) or set(body) != {'question', 'answer', 'grant'}:
            raise ContractError(400, 'VALIDATION_ERROR', '합성 대화 항목을 확인해 주세요.')
        if not all(isinstance(body[key], str) and 0 < len(body[key]) <= limit
                   for key, limit in [('question', 500), ('answer', 1000), ('grant', 1500)]):
            raise ContractError(400, 'VALIDATION_ERROR', '합성 대화 항목을 확인해 주세요.')
        try:
            grant = signing.loads(body['grant'], salt=SALT)
        except signing.BadSignature:
            raise ContractError(403, 'FORBIDDEN', '합성 저장을 허용하지 않았어요.') from None
        if (not isinstance(grant, dict) or grant.get('scope') != scope
                or grant.get('raw') != raw_fingerprint(body['question'], body['answer'])
                or type(grant.get('expires')) is not float or not now.timestamp() < grant['expires'] <= (
                    now + timedelta(hours=1)).timestamp()):
            raise ContractError(403, 'FORBIDDEN', '합성 저장을 허용하지 않았어요.')
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO transcript_trial VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING',
                [*scope, body['question'], body['answer'], datetime.fromtimestamp(grant['expires'], UTC)],
            )
            if cursor.rowcount:
                return Response(status=201, headers=PRIVATE_HEADERS)
            cursor.execute(f'SELECT question, answer FROM transcript_trial WHERE {OWNER_SCOPE}', scope)
            if cursor.fetchone() != (body['question'], body['answer']):
                raise ContractError(409, 'TRANSCRIPT_CONFLICT', '기존 검수 기록을 덮어쓸 수 없어요.')
            return Response(status=200, headers=PRIVATE_HEADERS)

    with connection.cursor() as cursor:
        if request.method == 'DELETE':
            cursor.execute(f'UPDATE transcript_trial SET question = NULL, answer = NULL WHERE {OWNER_SCOPE} '
                           'AND question IS NOT NULL AND expires_at > %s', [*scope, now])
            if cursor.rowcount:
                return Response(status=204, headers=PRIVATE_HEADERS)
        else:
            cursor.execute(f'SELECT question, answer FROM transcript_trial WHERE {OWNER_SCOPE} '
                           'AND question IS NOT NULL AND expires_at > %s', [*scope, now])
            record = cursor.fetchone()
            if record is not None:
                return Response(dict(zip(['question', 'answer'], record, strict=True)), headers=PRIVATE_HEADERS)
    raise ContractError(404, 'NOT_FOUND', '합성 검수 기록을 찾을 수 없어요.')


urlpatterns = [
    path('api/__trial/docent-transcript/<str:exhibition_id>/<str:artwork_id>/<uuid:visit_id>/<uuid:turn_id>', transcript_probe),
    path('', include('config.urls')),
]


@override_settings(ROOT_URLCONF=__name__, ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_DOCENT_MEMORY_DEMO=True,
                   OPENAI_BASE_URL='http://127.0.0.1:1/v1', ARTI_LLM_PROVIDER='openai_compatible',
                   OPENAI_API_KEY='synthetic-transcript-trial', OPENAI_MODEL='synthetic-transcript-trial',
                   ARTI_LLM_MODELS={}, ARTI_LLM_JSON_MODE=True, ARTI_LLM_TOKEN_PARAMETER='max_completion_tokens')
class TranscriptPilotTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('load_test_fixture', stdout=io.StringIO())
        ensure_visitor_memory_fixture()
        cls.owner = Account.objects.create(role='user', login_id='transcript-owner@example.test')
        cls.other = Account.objects.create(role='user', login_id='transcript-other@example.test')

    def setUp(self):
        cache.clear()
        # pg_temp leaves the trial table inaccessible outside this PostgreSQL test connection.
        with connection.cursor() as cursor:
            cursor.execute('''CREATE TEMP TABLE transcript_trial (
                owner_id text NOT NULL, exhibition_id text NOT NULL, artwork_id text NOT NULL,
                visit_id uuid NOT NULL, turn_id uuid NOT NULL, question text, answer text,
                expires_at timestamptz NOT NULL,
                PRIMARY KEY (owner_id, exhibition_id, artwork_id, visit_id, turn_id)
            ) ON COMMIT DROP''')
        self.visit_id = str(uuid4())
        self.turn_id = str(uuid4())
        self.route = self.transcript_route(SOURCE, SOURCE_WORK)
        self.deadline = timezone.now() + timedelta(hours=1)
        self.raw = {'question': f'합성 질문 {uuid4()}', 'answer': f'합성 답변 {uuid4()}'}
        self.payload = {**self.raw, 'grant': signing.dumps({
            'scope': [self.owner.pk, SOURCE, SOURCE_WORK, self.visit_id, self.turn_id],
            'raw': raw_fingerprint(**self.raw), 'expires': self.deadline.timestamp(),
        }, salt=SALT)}
        self.owner_client = self.browser(self.owner)

    def transcript_route(self, exhibition_id, artwork_id):
        return f'/api/__trial/docent-transcript/{exhibition_id}/{artwork_id}/{self.visit_id}/{self.turn_id}'

    def browser(self, actor=None):
        client = APIClient(HTTP_HOST='localhost')
        if actor is not None:
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {issue(actor).data["token"]}')
        return client

    def save(self):
        return self.owner_client.post(self.route, self.payload, format='json').status_code

    def ask_next(self, client, actor=None):
        return client.post(f'/api/artworks/{TARGET_WORK}/ask', {
            'question': '어디부터 보면 좋나요?', 'visitId': str(uuid4()),
            'visitorMemory': {'ownerId': actor.pk if actor else None, 'earlier': [], 'preferredTags': []},
        }, format='json')

    def receipt(self):
        work = Artwork.objects.get(pk=SOURCE_WORK)
        return self.owner_client.post('/api/visits', {
            'visitId': self.visit_id, 'exhibitionId': SOURCE, 'date': timezone.now().isoformat(),
            'durationMin': 15, 'selectedDuration': None, 'visitMode': 'exhibition_order',
            'recommendedCount': 3, 'requestGeneration': 1, 'viewedArtworkIds': [SOURCE_WORK],
            'reactions': {SOURCE_WORK: 'like'}, 'docentInterests': [{
                'artworkId': SOURCE_WORK, 'contentVersion': work.content_version, 'topics': ['light'],
                'style': 'simple', **self.raw,
            }],
        }, format='json')

    def test_opt_in_signature_retry_and_scope(self):
        with endpoint() as calls:
            reply = self.owner_client.post(f'/api/artworks/{SOURCE_WORK}/ask', {
                'question': self.raw['question'], 'visitId': self.visit_id,
            }, format='json')
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(len(calls), 1)
            self.assertEqual(self.owner_client.get(self.route).status_code, 404)
        self.assertEqual(self.owner_client.post(self.route, self.raw, format='json').status_code, 400)
        self.assertEqual(self.owner_client.post(
            self.route, {**self.payload, 'answer': '변경된 답변'}, format='json').status_code, 403)
        self.assertEqual((self.save(), self.save()), (201, 200))
        restored = self.browser(self.owner).get(self.route)
        self.assertTrue(restored.json() == self.raw)
        self.assertEqual(restored.headers['Cache-Control'], 'private, no-store')
        other_visit = self.route.replace(self.visit_id, str(uuid4()))
        other_exhibition = self.transcript_route(TARGET, TARGET_WORK)
        self.assertEqual(self.owner_client.get(other_visit).status_code, 404)
        self.assertEqual(self.owner_client.get(other_exhibition).status_code, 404)
        self.assertEqual(self.owner_client.post(other_exhibition, self.payload, format='json').status_code, 403)
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM transcript_trial')
            self.assertEqual(cursor.fetchone(), (1,))

    def test_other_member_guest_and_unregistered_application_route(self):
        self.assertEqual(self.save(), 201)
        other = self.browser(self.other)
        guest = self.browser()
        self.assertEqual(other.post(self.route, self.payload, format='json').status_code, 403)
        self.assertEqual(other.get(self.route).status_code, 404)
        self.assertEqual(other.delete(self.route).status_code, 404)
        for action in (guest.get, guest.delete):
            self.assertEqual(action(self.route).status_code, 401)
        self.assertEqual(guest.post(self.route, self.payload, format='json').status_code, 401)
        self.assertEqual(self.owner_client.get(self.route).status_code, 200)
        Session.objects.filter(account=self.owner).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.owner_client.get(self.route).status_code, 401)
        self.owner_client = self.browser(self.owner)
        self.assertEqual(self.owner_client.get(self.route).status_code, 200)
        with override_settings(ARTI_ENV='production'):
            self.assertEqual(self.owner_client.get(self.route).status_code, 404)
            settings_route = f'/api/users/{self.owner.pk}/docent-memory'
            self.assertEqual(self.owner_client.get(settings_route).status_code, 404)
        with override_settings(ROOT_URLCONF='config.urls'):
            self.assertEqual(self.owner_client.get(self.route).status_code, 404)

    def test_expiry_and_purge_remove_the_raw_text(self):
        self.assertEqual(self.save(), 201)
        with patch('arti.tests.test_docent_transcript_pilot.timezone.now', return_value=self.deadline):
            self.assertEqual(self.owner_client.get(self.route).status_code, 404)
            with connection.cursor() as cursor:
                cursor.execute('DELETE FROM transcript_trial WHERE expires_at <= %s', [timezone.now()])
                self.assertEqual(cursor.rowcount, 1)
            self.assertEqual(self.save(), 403)

    def test_transcript_delete_and_memory_reset_are_independent(self):
        with endpoint() as calls:
            self.assertEqual(self.save(), 201)
            receipt = self.receipt()
            self.assertEqual(receipt.status_code, 201)
            saved = Visit.objects.get(pk=receipt.json()['id'])
            self.assertTrue(saved.docent_memory['visit']['topics'] == ['light'])
            next_reply = self.ask_next(self.owner_client, self.owner)
            self.assertEqual(next_reply.status_code, 200)
            self.assertTrue(next_reply.json()['usedPreviousVisitMemory'])
            prompt = json.loads(calls[-1]['body']['messages'][1]['content'])
            self.assertIn('previousVisit', prompt['visitorContext'])
            self.assertTrue(all(value not in str(prompt) and value not in str(saved.docent_memory)
                                for value in self.raw.values()))
            for actor in (self.other, None):
                self.assertEqual(self.ask_next(self.browser(actor), actor).status_code, 200)
                prompt = json.loads(calls[-1]['body']['messages'][1]['content'])
                self.assertNotIn('visitorContext', prompt)

            self.assertEqual(self.owner_client.delete(self.route).status_code, 204)
            self.assertEqual(self.owner_client.get(self.route).status_code, 404)
            self.assertEqual(self.save(), 409)
            with connection.cursor() as cursor:
                cursor.execute('SELECT question, answer FROM transcript_trial')
                self.assertTrue(cursor.fetchone() == (None, None))
            self.assertTrue(self.ask_next(self.owner_client, self.owner).json()['usedPreviousVisitMemory'])
            settings_route = f'/api/users/{self.owner.pk}/docent-memory'
            self.assertEqual(self.owner_client.patch(settings_route, {'reset': True}, format='json').status_code, 200)
            self.assertNotIn('usedPreviousVisitMemory', self.ask_next(self.owner_client, self.owner).json())
            saved.refresh_from_db()
            self.assertNotIn('visit', saved.docent_memory)
            self.assertIn(SOURCE_WORK, saved.docent_memory['works'])

    def test_cross_visit_reset_leaves_independently_authorized_transcript(self):
        with endpoint():
            self.assertEqual(self.save(), 201)
            self.assertEqual(self.receipt().status_code, 201)
            self.assertTrue(self.ask_next(self.owner_client, self.owner).json()['usedPreviousVisitMemory'])
            settings_route = f'/api/users/{self.owner.pk}/docent-memory'
            self.assertEqual(self.owner_client.patch(settings_route, {'reset': True}, format='json').status_code, 200)
            self.assertNotIn('usedPreviousVisitMemory', self.ask_next(self.owner_client, self.owner).json())
            response = self.owner_client.get(self.route)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json() == self.raw)
