import io
from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti.docent_transcript import DOCENT_TRANSCRIPT_NOTICE_VERSION
from arti.http import ContractError
from arti.member import issue
from arti.models import Account, DocentTranscript, DocentTranscriptConsent, Visit, VisitReaction


WORK = 'fixture-art01'
ASK = f'/api/artworks/{WORK}/ask'
LIKED = f'/api/artworks/{WORK}/liked-recap'
ANSWER = {'answer': '밝은 부분부터 살펴보세요.', 'collectionEvidenceUsed': False}


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_DOCENT_TRANSCRIPTS_ENABLED=True)
class DocentTranscriptTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('load_test_fixture', stdout=io.StringIO())
        cls.owner = Account.objects.create(login_id='transcript-owner@example.test', role='user')
        cls.other = Account.objects.create(login_id='transcript-other@example.test', role='user')

    def setUp(self):
        cache.clear()
        self.client = self.member_client(self.owner)
        self.other_client = self.member_client(self.other)
        self.settings = f'/api/users/{self.owner.pk}/docent-transcript'
        self.visit = str(uuid4())

    @staticmethod
    def member_client(account):
        client = APIClient(HTTP_HOST='localhost')
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {issue(account).data["token"]}')
        return client

    def approve(self):
        response = self.client.patch(self.settings, {
            'enabled': True, 'noticeVersion': DOCENT_TRANSCRIPT_NOTICE_VERSION,
        }, format='json')
        self.assertEqual(response.status_code, 204, response.data)

    def ask(self, client=None, **changes):
        payload = {'question': '빛은 어디에 보이나요?', 'visitId': self.visit, 'transcriptTurnId': str(uuid4())}
        payload.update(changes)
        return (client or self.client).post(ASK, payload, format='json')

    def like(self, *, owner=None, visit_id=None):
        visit = Visit.objects.create(
            user=owner or self.owner, visit_id=visit_id or self.visit, exhibition_id='fixture-ex01',
            canonical_payload={'date': timezone.now().isoformat()},
        )
        VisitReaction.objects.create(visit=visit, artwork_id=WORK, reaction='like')
        return visit

    @patch('arti.docent.providers.generate', return_value=ANSWER)
    def test_only_current_consent_and_server_success_are_recorded(self, _generate):
        self.assertEqual(self.ask().status_code, 200)
        self.assertEqual(self.client.patch(self.settings, {
            'enabled': True, 'noticeVersion': 'outdated',
        }, format='json').status_code, 400)
        self.approve()
        self.assertEqual(self.ask(APIClient(HTTP_HOST='localhost')).status_code, 200)
        self.assertFalse(DocentTranscript.objects.exists())
        with patch('arti.docent.providers.generate',
                   side_effect=ContractError(502, 'PROVIDER_ERROR', '모의 오류')):
            self.assertEqual(self.ask().status_code, 502)
        self.assertFalse(DocentTranscript.objects.exists())
        turn = str(uuid4())
        self.assertEqual(self.ask(transcriptTurnId=turn, history=[
            {'role': 'user', 'text': '붙여넣은 기록'}, {'role': 'assistant', 'text': '붙여넣은 답변'},
        ]).status_code, 200)
        self.assertEqual(self.ask(transcriptTurnId=turn).status_code, 200)
        self.assertEqual(DocentTranscript.objects.get().turns, [{
            'id': turn, 'question': '빛은 어디에 보이나요?', 'answer': ANSWER['answer'],
        }])
        self.assertEqual(self.client.patch(self.settings, {'enabled': False}, format='json').status_code, 204)
        self.assertEqual(self.ask().status_code, 200)
        self.assertEqual(len(DocentTranscript.objects.get().turns), 1)

    @patch('arti.docent.providers.generate', return_value=ANSWER)
    def test_likes_are_owner_scoped_and_deleting_preserves_receipt(self, _generate):
        self.approve()
        self.assertEqual(self.ask().status_code, 200)
        self.assertEqual(self.client.get(LIKED).status_code, 404)
        receipt = self.like()
        self.like(owner=self.other, visit_id=str(uuid4()))
        response = self.client.get(LIKED)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response.data['conversations'][0]['turns'][0]['answer'], ANSWER['answer'])
        self.assertEqual(self.other_client.get(LIKED).data['conversations'], [])
        self.assertEqual(self.other_client.get(self.settings).status_code, 403)
        self.assertEqual(APIClient(HTTP_HOST='localhost').get(LIKED).status_code, 401)
        delete_url = f'{LIKED}/{self.visit}'
        self.assertEqual(self.other_client.delete(delete_url).status_code, 404)
        self.assertEqual(self.client.delete(delete_url).status_code, 204)
        self.assertEqual(self.ask().status_code, 200)
        self.assertEqual(self.client.get(LIKED).data['conversations'], [])
        self.assertTrue(DocentTranscript.objects.get().deleted)
        self.assertEqual(DocentTranscript.objects.get().turns, [])
        self.assertTrue(VisitReaction.objects.filter(visit=receipt, reaction='like').exists())

    def test_global_erasure_invalidates_late_response(self):
        self.approve()
        cons = DocentTranscriptConsent.objects.get(account=self.owner)
        self.assertEqual(cons.version, DOCENT_TRANSCRIPT_NOTICE_VERSION)

        def erase_during_generation(*args, **kwargs):
            self.assertEqual(self.client.delete(self.settings).status_code, 204)
            return ANSWER

        with patch('arti.docent.providers.generate', side_effect=erase_during_generation):
            self.assertEqual(self.ask().status_code, 200)
        self.assertFalse(DocentTranscript.objects.exists())
        self.assertTrue(self.client.get(self.settings).data['enabled'])

    @patch('arti.docent.providers.generate', return_value=ANSWER)
    def test_account_cascade_and_reading_with_flag_off(self, _generate):
        self.approve()
        self.assertEqual(self.ask().status_code, 200)
        receipt = self.like()
        with override_settings(ARTI_DOCENT_TRANSCRIPTS_ENABLED=False):
            self.assertEqual(self.client.get(LIKED).data['conversations'][0]['visitId'], self.visit)
            self.assertEqual(self.client.get(self.settings).data['storageAvailable'], False)
            self.assertEqual(self.ask().status_code, 200)
            self.assertEqual(len(DocentTranscript.objects.get().turns), 1)
        receipt.delete()
        self.owner.delete()
        self.assertFalse(DocentTranscript.objects.exists())
        self.assertFalse(DocentTranscriptConsent.objects.exists())
