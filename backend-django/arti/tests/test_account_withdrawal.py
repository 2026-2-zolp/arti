from datetime import date, timedelta
from uuid import uuid4

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti.docent_transcript import DOCENT_TRANSCRIPT_NOTICE_VERSION
from arti.member import SIGNUP_TERMS_VERSION
from arti.models import (
    Account, Artwork, DocentTranscript, DocentTranscriptConsent, Exhibition, KakaoIdentity, KakaoOAuthFlow,
    PasswordResetDelivery, Session, SignupTermsAcceptance, Visit, VisitReaction,
)


@override_settings(ARTI_DOCENT_TRANSCRIPTS_ENABLED=True)
class AccountWithdrawalTests(TestCase):
    password = 'withdraw-test-123'

    def setUp(self):
        cache.clear()
        self.guest = APIClient(HTTP_HOST='localhost')
        self.owner, self.token = self.signup('owner@example.test', consent=True)
        self.other, self.other_token = self.signup('other@example.test')
        year = date.today().year
        exhibition = Exhibition.objects.create(title='Synthetic', start_date=date(year, 1, 1),
                                               end_date=date(year, 12, 31))
        artwork = Artwork.objects.create(title='Synthetic', artist='Fixture', exhibition=exhibition)
        self.visits = [Visit.objects.create(user=account, visit_id=uuid4(), exhibition=exhibition)
                       for account in (self.owner, self.other)]
        for visit in self.visits:
            VisitReaction.objects.create(visit=visit, artwork=artwork, reaction='like')
        DocentTranscript.objects.create(account=self.owner, artwork=artwork, visit_id=self.visits[0].visit_id,
                                        turns=[{'question': 'Fixture question', 'answer': 'Fixture answer'}])
        now = timezone.now()
        PasswordResetDelivery.objects.create(account=self.owner, email_key='fixture', token_id=uuid4(),
                                             expires_at=now + timedelta(minutes=30), next_attempt_at=now)
        KakaoIdentity.objects.create(account=self.owner, client_id='fixture', subject='subject')
        KakaoOAuthFlow.objects.create(account=self.owner, browser_hash='fixture-flow',
                                      expires_at=now + timedelta(minutes=10))
        self.second_owner_token = self.login(self.owner.email).json()['token']
        self.path = f'/api/users/{self.owner.pk}/withdrawal'

    def signup(self, email, consent=False):
        response = self.guest.post('/api/auth/signup', {
            'email': email, 'password': self.password, 'termsAccepted': True,
            'termsVersion': SIGNUP_TERMS_VERSION, 'docentTranscriptAccepted': consent,
            **({'docentTranscriptNoticeVersion': DOCENT_TRANSCRIPT_NOTICE_VERSION} if consent else {}),
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        return Account.objects.get(pk=data['user']['id']), data['token']

    def login(self, email):
        return self.guest.post('/api/auth/login', {'email': email, 'password': self.password}, format='json')

    def withdraw(self, token, password):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}
        return self.guest.post(self.path, {'currentPassword': password}, format='json', **headers)

    def test_rejects_unauthenticated_cross_account_and_wrong_password(self):
        self.assertEqual(self.withdraw(None, self.password).status_code, 401)
        self.assertEqual(self.withdraw(self.other_token, self.password).status_code, 403)
        wrong = self.withdraw(self.token, 'incorrect-password-456')
        self.assertEqual((wrong.status_code, wrong.json()['code']), (400, 'WITHDRAWAL_PASSWORD_REQUIRED'))
        self.assertTrue(Account.objects.filter(pk=self.owner.pk).exists())
        self.assertEqual(VisitReaction.objects.count(), 2)
        self.assertEqual(Session.objects.filter(account=self.owner).count(), 2)

    def test_withdrawal_removes_owner_links_and_revokes_all_sessions(self):
        response = self.withdraw(self.token, self.password)
        self.assertEqual(response.status_code, 204, response.content)
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        account_id = self.owner.pk
        for model in (Session, SignupTermsAcceptance, DocentTranscriptConsent, DocentTranscript, PasswordResetDelivery,
                      KakaoIdentity, KakaoOAuthFlow):
            self.assertFalse(model.objects.filter(account_id=account_id).exists())
        self.assertFalse(Account.objects.filter(pk=account_id).exists())
        self.assertFalse(Visit.objects.filter(id=self.visits[0].pk).exists())
        self.assertTrue(VisitReaction.objects.filter(visit_id=self.visits[1].pk).exists())
        for token, status in ((self.token, 401), (self.second_owner_token, 401), (self.other_token, 200)):
            self.assertEqual(self.guest.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}').status_code, status)
        self.assertEqual(self.login(self.owner.email).status_code, 401)
        self.assertEqual(self.login(self.other.email).status_code, 200)
