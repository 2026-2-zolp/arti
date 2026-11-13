# 회원가입 입력과 약관 기록 계약을 검증합니다.
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from arti.member import SIGNUP_TERMS_VERSION
from arti.models import Account, Session, SignupTermsAcceptance


class SignupContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(HTTP_HOST='localhost')

    def signup(self, **changes):
        return self.client.post('/api/auth/signup', {
            'email': 'review@example.test', 'password': 'valid-password123',
            'termsAccepted': True, 'termsVersion': SIGNUP_TERMS_VERSION, **changes
        }, format='json')

    def test_agreement_is_recorded_once_with_server_timestamp(self):
        before = timezone.now()
        response = self.signup(acceptedAt='2000-01-01T00:00:00Z')
        self.assertEqual(response.status_code, 200, response.content)
        record = SignupTermsAcceptance.objects.get(account_id=response.json()['user']['id'])
        self.assertEqual(record.version, SIGNUP_TERMS_VERSION)
        self.assertLessEqual(before, record.accepted_at)
        self.assertLessEqual(record.accepted_at, timezone.now())
        accepted_at = record.accepted_at
        self.assertEqual(self.signup().status_code, 400)
        self.assertEqual(SignupTermsAcceptance.objects.count(), 1)
        self.assertEqual(Session.objects.count(), 1)
        record.refresh_from_db()
        self.assertEqual(record.accepted_at, accepted_at)

    def test_missing_false_or_stale_agreement_cannot_create_account(self):
        response = self.client.post('/api/auth/signup', {
            'email': 'review@example.test', 'password': 'valid-password123',
        }, format='json')
        self.assertEqual((response.status_code, response.json()['code']), (400, 'TERMS_REQUIRED'))
        for accepted in (False, 1, 'true'):
            response = self.signup(termsAccepted=accepted)
            self.assertEqual((response.status_code, response.json()['code']), (400, 'TERMS_REQUIRED'))
        for version in (None, 'older'):
            response = self.signup(termsVersion=version)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'TERMS_VERSION_CHANGED'))
        self.assertFalse(Account.objects.exists())
        self.assertFalse(Session.objects.exists())
        self.assertFalse(SignupTermsAcceptance.objects.exists())

    def test_agreement_or_session_write_failure_rolls_back_signup(self):
        for model in (SignupTermsAcceptance, Session):
            with self.subTest(model=model):
                with patch.object(model.objects, 'create', side_effect=IntegrityError):
                    response = self.signup()
                self.assertEqual(response.status_code, 400, response.content)
                self.assertFalse(Account.objects.exists())
                self.assertFalse(Session.objects.exists())
                self.assertFalse(SignupTermsAcceptance.objects.exists())

    def test_existing_account_can_login_without_signup_terms_record(self):
        Account.objects.create(login_id='review@example.test', email='review@example.test',
                               role='user', password=make_password('valid-password123'))
        response = self.client.post('/api/auth/login', {
            'email': 'review@example.test', 'password': 'valid-password123',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(SignupTermsAcceptance.objects.exists())

    def test_missing_or_blank_nickname_can_signup_and_login(self):
        for index, nickname in enumerate((None, '', '   ')):
            with self.subTest(nickname=nickname):
                data = {'email': f'review{index}@example.test'}
                if nickname is not None:
                    data['nickname'] = nickname
                response = self.signup(**data)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()['user']['nickname'], '')
                self.assertEqual(Account.objects.get(email=data['email']).nickname, '')
                login = self.client.post('/api/auth/login', {
                    'email': data['email'], 'password': 'valid-password123'
                }, format='json')
                self.assertEqual(login.status_code, 200, login.content)

    def test_nickname_boundary_and_trim(self):
        response = self.signup(nickname='  ' + '가' * 100 + '  ')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['user']['nickname'], '가' * 100)
        response = self.signup(email='other@example.test', nickname='가' * 101)
        self.assertEqual(response.status_code, 400)
        self.assertIn('닉네임', response.content.decode())
        self.assertFalse(Account.objects.filter(email='other@example.test').exists())

    def test_invalid_password_is_rejected_without_creating_account(self):
        response = self.signup(nickname='', password='12345678')
        self.assertEqual(response.status_code, 400)
        self.assertIn('비밀번호', response.content.decode())
        self.assertNotIn('닉네임', response.content.decode())
        self.assertEqual(Account.objects.count(), 0)

    def test_nickname_type_is_checked(self):
        self.assertEqual(self.signup(nickname=None).status_code, 400)
