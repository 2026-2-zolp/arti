import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.core import mail
from django.core.cache import cache
from django.db import close_old_connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti.models import Account, KakaoIdentity, PasswordResetDelivery, Session, Visit
from arti.password_reset import deliver_pending
from arti.tests.test_integration import Helpers


@override_settings(ARTI_PASSWORD_RESET_ORIGIN='http://127.0.0.1:5277',
                   ARTI_PASSWORD_RESET_FROM='reset@example.test',
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
                   ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class PasswordResetTests(Helpers, TransactionTestCase):
    request_path = '/api/auth/password-reset/request'
    confirm_path = '/api/auth/password-reset/confirm'
    password = 'new-Fixture-42!'

    def setUp(self):
        self.setup_clients()
        self.member = self.actors[0]
        self.member.login_id = self.member.email
        self.member.save(update_fields=['login_id'])
        mail.get_connection()
        mail.outbox.clear()

    def request_link(self, email='a@example.test'):
        return self.public.post(self.request_path, {'email': email}, format='json')

    def token(self, index=0):
        return re.search(r'/password/reset#token=([a-f0-9.]+)', mail.outbox[index].body).group(1)

    def confirm(self, token, password=None):
        return self.public.post(self.confirm_path, {'token': token, 'password': password or self.password}, format='json')

    def test_link_resets_the_same_member_and_preserves_kakao_and_receipt(self):
        KakaoIdentity.objects.create(account=self.member, client_id='fixture-app', subject='fixture-subject')
        self.assertEqual(self.a.post('/api/visits', self.payload(), format='json').status_code, 201)
        before = Visit.objects.get(user=self.member).id
        for email in [' A@example.test ', 'unknown@example.test', 'admin@example.test', 'a@example.test']:
            response = self.request_link(email)
            self.assertEqual((response.status_code, response.content), (204, b''))
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(deliver_pending(), 2)
        self.assertEqual([m.to for m in mail.outbox], [['a@example.test'], ['a@example.test']])
        self.assertEqual(deliver_pending(), 0)
        self.assertEqual(self.confirm(self.token(), 'invalid').status_code, 400)
        self.assertEqual(self.confirm(self.token()).status_code, 204)
        for token in [self.token(), self.token(1)]:
            self.assertEqual(self.confirm(token).json()['code'], 'PASSWORD_RESET_INVALID')
        self.assertFalse(Session.objects.filter(account=self.member).exists())
        self.assertEqual(self.a.get('/api/auth/me').status_code, 401)
        self.assertEqual(self.b.get('/api/auth/me').status_code, 200)
        self.assertEqual(self.member.kakaoidentity_set.get().subject, 'fixture-subject')
        self.assertEqual(Visit.objects.get(user=self.member).id, before)
        self.assertEqual(self.public.post('/api/auth/login', {'email': self.member.email, 'password': 'test-password-strong'}, format='json').status_code, 401)
        logged_in = self.public.post('/api/auth/login', {'email': self.member.email, 'password': self.password}, format='json')
        self.assertEqual(logged_in.json()['user']['id'], self.member.id)

    def test_expiry_forged_signature_and_request_limits(self):
        for _ in range(4):
            self.assertEqual(self.request_link().status_code, 204)
            self.assertEqual(self.request_link('missing@example.test').status_code, 204)
        self.assertEqual(PasswordResetDelivery.objects.filter(account=self.member).count(), 3)
        self.assertEqual(PasswordResetDelivery.objects.filter(account=None).count(), 3)
        self.assertEqual(deliver_pending(), 3)
        token = self.token()
        token_id, signature = token.split('.')
        self.assertEqual(self.confirm(token_id + '.' + ('0' if signature[0] != '0' else '1') + signature[1:]).status_code, 400)
        PasswordResetDelivery.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.confirm(token).json()['code'], 'PASSWORD_RESET_INVALID')
        self.assertEqual(deliver_pending(), 0)
        self.assertFalse(PasswordResetDelivery.objects.exists())

    def test_dormant_and_email_changed_accounts_cannot_use_links(self):
        self.assertEqual(self.request_link().status_code, 204)
        Account.objects.filter(pk=self.member.pk).update(status='dormant')
        self.assertEqual(deliver_pending(), 0)
        Account.objects.filter(pk=self.member.pk).update(status='active')
        self.assertEqual(self.request_link().status_code, 204)
        self.assertEqual(deliver_pending(), 1)
        Account.objects.filter(pk=self.member.pk).update(email='different@example.test')
        self.assertEqual(self.confirm(self.token()).json()['code'], 'PASSWORD_RESET_INVALID')

    def test_two_concurrent_confirmations_yield_one_password_change(self):
        self.assertEqual(self.request_link().status_code, 204)
        self.assertEqual(deliver_pending(), 1)
        token = self.token()
        ready = Barrier(2)

        def submit(number):
            close_old_connections()
            try:
                ready.wait(timeout=8)
                client = APIClient(HTTP_HOST='localhost', REMOTE_ADDR=f'192.0.2.{number}')
                return client.post(self.confirm_path, {'token': token, 'password': self.password + str(number)}, format='json').status_code
            finally:
                close_old_connections()

        cache.clear()
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(submit, [1, 2])), [204, 400])

    def test_mail_failure_defers_delivery_without_issuing_a_usable_link(self):
        self.assertEqual(self.request_link().status_code, 204)
        with patch('arti.password_reset.send_mail', side_effect=OSError('synthetic')):
            self.assertEqual(deliver_pending(), 0)
        delivery = PasswordResetDelivery.objects.get()
        self.assertFalse(delivery.delivered)
        self.assertIsNone(delivery.processed_at)
        self.assertEqual(deliver_pending(), 0)
        PasswordResetDelivery.objects.update(next_attempt_at=timezone.now())
        self.assertEqual(deliver_pending(), 1)
        self.assertEqual(self.confirm(self.token()).status_code, 204)
