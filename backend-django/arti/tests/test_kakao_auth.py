import base64
import hashlib
import re
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti import kakao
from arti.kakao_auth import COMPLETE_PATH, COOKIE_PATH, FLOW_COOKIE
from arti.models import Account, Exhibition, KakaoIdentity, KakaoOAuthFlow, Session, Visit
from arti.password_reset import deliver_pending

CLIENT_ID = 'test-kakao-app'
CALLBACK = 'https://arti.example.test/api/auth/kakao/callback'
PASSWORD = 'demo-password1'
BASE = '/api/auth/kakao'


def signing_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk.update(kid='test-signing-key', use='sig', alg='RS256')
    return key, jwk


def signed_identity(key, jwk, nonce, subject, /, **overrides):
    now = timezone.now()
    claims = {'iss': kakao.ISSUER, 'aud': CLIENT_ID, 'sub': subject, 'iat': now,
              'exp': now + timedelta(minutes=5), 'nonce': nonce, **overrides}
    return jwt.encode(claims, key, algorithm='RS256', headers={'kid': jwk['kid']})


@override_settings(ARTI_KAKAO_CLIENT_ID=CLIENT_ID, ARTI_KAKAO_CLIENT_SECRET='test-secret',
                   ARTI_KAKAO_CALLBACK_URL=CALLBACK)
class KakaoAuthTests(TestCase):
    client_class = APIClient

    @classmethod
    def setUpTestData(cls):
        password = make_password(PASSWORD)
        cls.account = Account.objects.create(login_id='member@example.test', email='member@example.test',
                                             role='user', password=password, tastes=['abstract'])
        cls.other = Account.objects.create(login_id='other@example.test', email='other@example.test',
                                           role='user', password=password)
        cls.key, cls.jwk = signing_material()

    def setUp(self):
        cache.clear()

    def login(self, browser, account):
        response = browser.post('/api/auth/login', {'email': account.email, 'password': PASSWORD}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        browser.credentials(HTTP_AUTHORIZATION='Bearer ' + response.data['token'])
        return response.data['token']

    def start(self, browser, mode, **kwargs):
        response = browser.post(BASE + '/start', {'mode': mode, **kwargs}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        cookie = response.cookies[FLOW_COOKIE]
        self.assertTrue(cookie['secure'] and cookie['httponly'])
        self.assertEqual((cookie['samesite'], cookie['path'], cookie['max-age']), ('Lax', COOKIE_PATH, 600))
        authorization = urlsplit(response.data['authorizationUrl'])
        self.assertEqual((authorization.scheme, authorization.netloc, authorization.path),
                         ('https', 'kauth.kakao.com', '/oauth/authorize'))
        params = {key: values[0] for key, values in parse_qs(authorization.query).items()}
        self.assertEqual(params['redirect_uri'], CALLBACK)
        self.assertEqual(params['client_id'], CLIENT_ID)
        self.assertEqual(params['code_challenge_method'], 'S256')
        self.assertFalse({'client_secret', 'email', 'scope'}.intersection(params))
        return params

    def provider(self, params, subject='123456789', *, key=None, **overrides):
        def response(request):
            if request.full_url == kakao.ISSUER + '/.well-known/jwks.json':
                return {'keys': [self.jwk]}
            self.assertEqual(request.full_url, kakao.ISSUER + '/oauth/token')
            self.assertEqual(request.method, 'POST')
            fields = parse_qs(request.data.decode())
            self.assertEqual(fields['client_secret'], ['test-secret'])
            self.assertEqual(fields['redirect_uri'], [CALLBACK])
            self.assertEqual(fields['code'], ['one-time-code'])
            verifier = fields['code_verifier'][0]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
            self.assertEqual(challenge, params['code_challenge'])
            return {'id_token': signed_identity(key or self.key, self.jwk, params['nonce'], subject,
                                                **({'email': self.account.email} | overrides)),
                    'access_token': 'unused-access-token', 'refresh_token': 'unused-refresh-token'}

        return patch('arti.kakao.request_json', side_effect=response)

    def callback(self, browser, params, *, accepted=True, **query):
        response = browser.get(BASE + '/callback', {'state': params['state'], **query})
        self.assertEqual(response.status_code, 302)
        expected = f"{COMPLETE_PATH}#state={params['state']}" if accepted else COMPLETE_PATH
        self.assertEqual(response['Location'], expected)
        self.assertEqual(response['Referrer-Policy'], 'no-referrer')
        self.assertIn('no-store', response['Cache-Control'])

    def submit_finish(self, browser, params, **headers):
        return browser.post(BASE + '/finish', {'state': params['state']}, format='json', **headers)

    def finish(self, browser, params, status):
        response = self.submit_finish(browser, params)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], status)
        self.assertEqual(response.cookies[FLOW_COOKIE]['max-age'], 0)
        self.assertIn('no-store', response['Cache-Control'])
        return response.data

    def test_existing_account_links_and_logs_in_with_same_id_taste_and_visit(self):
        today = timezone.localdate()
        exhibition = Exhibition.objects.create(title='OAuth test', start_date=today, end_date=today)
        visit = Visit.objects.create(user=self.account, visit_id=uuid4(), exhibition=exhibition,
                                     canonical_payload={'tastes': self.account.tastes, 'viewedArtworkIds': [], 'dwell': {}})
        original_token = self.login(self.client, self.account)
        self.assertEqual(self.client.get(BASE + '/status').data, {'enabled': True, 'linked': False})
        link = self.start(self.client, 'link', password=PASSWORD)
        self.assertEqual(link['prompt'], 'login')
        with self.provider(link) as provider:
            self.callback(self.client, link, code='one-time-code')
            self.callback(self.client, link, code='one-time-code', accepted=False)
            self.assertEqual(provider.call_count, 2)
        flow = KakaoOAuthFlow.objects.get()
        self.assertEqual((flow.nonce, flow.verifier), ('', ''))
        self.assertEqual(self.finish(self.client, link, 'linked'), {'status': 'linked', 'returnTo': '/mypage'})
        self.assertEqual(self.client.get(BASE + '/status').data, {'enabled': True, 'linked': True})
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 204)
        self.client.credentials()

        target = '/exhibitions/real-exhibition/taste/saved'
        login = self.start(self.client, 'login', returnTo=target)
        with self.provider(login):
            self.callback(self.client, login, code='one-time-code')
        result = self.finish(self.client, login, 'logged_in')
        self.assertEqual(result['returnTo'], target)
        self.assertEqual(result['user']['id'], self.account.pk)
        self.assertEqual(result['user']['tastes'], self.account.tastes)
        self.assertNotEqual(result['token'], original_token)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + result['token'])
        self.assertEqual(self.client.get('/api/auth/me').data['id'], self.account.pk)
        records = self.client.get(f'/api/users/{self.account.pk}/visits')
        self.assertEqual([record['id'] for record in records.data], [visit.pk])
        self.assertEqual(self.submit_finish(self.client, login).status_code, 400)
        self.assertFalse(KakaoOAuthFlow.objects.exists())

    @override_settings(ARTI_ENV='test', ARTI_PASSWORD_RESET_ORIGIN='http://127.0.0.1:5277',
                       ARTI_PASSWORD_RESET_FROM='reset@example.test',
                       EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_email_recovery_keeps_kakao_login_and_the_same_receipt(self):
        today = timezone.localdate()
        exhibition = Exhibition.objects.create(title='Synthetic recovery', start_date=today, end_date=today)
        visit = Visit.objects.create(user=self.account, visit_id=uuid4(), exhibition=exhibition,
                                     canonical_payload={'tastes': self.account.tastes, 'viewedArtworkIds': [], 'dwell': {}})
        original_token = self.login(self.client, self.account)
        link = self.start(self.client, 'link', password=PASSWORD)
        with self.provider(link):
            self.callback(self.client, link, code='one-time-code')
        self.finish(self.client, link, 'linked')

        recovery = APIClient()
        mail.get_connection()
        mail.outbox.clear()
        reset = '/api/auth/password-reset'
        self.assertEqual(recovery.post(reset + '/request', {'email': self.account.email}, format='json').status_code, 204)
        self.assertEqual(deliver_pending(), 1)
        self.assertEqual(len(mail.outbox), 1)
        token = re.search(r'/password/reset#token=([a-f0-9.]+)', mail.outbox[0].body).group(1)
        payload = {'token': token, 'password': 'Synthetic-new-42!'}
        self.assertEqual(recovery.post(reset + '/confirm', payload, format='json').status_code, 204)
        self.assertEqual(recovery.post(reset + '/confirm', payload, format='json').status_code, 400)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

        login = self.start(recovery, 'login')
        with self.provider(login):
            self.callback(recovery, login, code='one-time-code')
        result = self.finish(recovery, login, 'logged_in')
        self.assertEqual(result['user']['id'], self.account.pk)
        self.assertNotEqual(result['token'], original_token)
        recovery.credentials(HTTP_AUTHORIZATION='Bearer ' + result['token'])
        records = recovery.get(f'/api/users/{self.account.pk}/visits')
        self.assertEqual(records.status_code, 200)
        self.assertEqual([record['id'] for record in records.data], [visit.pk])

    def test_matching_email_never_links_or_creates_accounts(self):
        params = self.start(self.client, 'login', returnTo='/%2fevil.example')
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.assertEqual(self.finish(self.client, params, 'unlinked'), {'status': 'unlinked', 'returnTo': '/'})
        self.assertEqual(Account.objects.count(), 2)
        self.assertFalse(Session.objects.exists())
        self.assertFalse(KakaoIdentity.objects.exists())

    def test_link_requires_member_current_password_and_same_session(self):
        self.assertEqual(self.client.post(BASE + '/start', {'mode': 'link', 'password': PASSWORD}, format='json').status_code, 401)
        first_token = self.login(self.client, self.account)
        bad = self.client.post(BASE + '/start', {'mode': 'link', 'password': 'wrong'}, format='json')
        self.assertEqual(bad.data['code'], 'KAKAO_PASSWORD_REQUIRED')
        params = self.start(self.client, 'link', password=PASSWORD)
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.login(self.client, self.other)
        self.assertEqual(self.submit_finish(self.client, params).status_code, 403)
        self.login(self.client, self.account)
        self.assertEqual(self.submit_finish(self.client, params).status_code, 403)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + first_token)
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 204)
        self.assertEqual(self.submit_finish(self.client, params).status_code, 403)
        self.assertFalse(KakaoIdentity.objects.exists())

    def test_one_kakao_subject_cannot_be_linked_to_another_account(self):
        KakaoIdentity.objects.create(client_id=CLIENT_ID, subject='123456789', account=self.other)
        self.login(self.client, self.account)
        params = self.start(self.client, 'link', password=PASSWORD)
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.assertNotIn('token', self.finish(self.client, params, 'conflict'))
        self.assertEqual(KakaoIdentity.objects.get().account_id, self.other.pk)

    def test_state_is_bound_to_browser_and_expires(self):
        params = self.start(self.client, 'login')
        with patch('arti.kakao.request_json') as provider:
            self.callback(APIClient(), params, code='one-time-code', accepted=False)
            self.callback(self.client, {'state': 'x' * 43}, code='one-time-code', accepted=False)
            self.assertEqual(self.submit_finish(self.client, params).status_code, 400)
            KakaoOAuthFlow.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
            self.callback(self.client, params, code='one-time-code', accepted=False)
            self.assertEqual(self.submit_finish(self.client, params).status_code, 400)
            provider.assert_not_called()
        self.start(self.client, 'login')
        self.assertEqual(KakaoOAuthFlow.objects.count(), 1)

    def test_invalid_id_token_is_rejected(self):
        wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        for case in ({'nonce': 'wrong'}, {'aud': 'another-app'}, {'iss': 'https://example.test'},
                     {'exp': timezone.now() - timedelta(seconds=1)}, {'key': wrong_key}):
            with self.subTest(case=case):
                params = self.start(self.client, 'login')
                with self.provider(params, **case):
                    self.callback(self.client, params, code='one-time-code')
                self.finish(self.client, params, 'failed')
        self.assertFalse(Session.objects.exists())

    def test_cancellation_and_provider_timeout_are_recoverable(self):
        params = self.start(self.client, 'login')
        with patch('arti.kakao.request_json') as provider:
            self.callback(self.client, params, error='access_denied')
            provider.assert_not_called()
        self.finish(self.client, params, 'cancelled')
        params = self.start(self.client, 'login')
        with patch('arti.kakao.request_json', side_effect=TimeoutError):
            self.callback(self.client, params, code='one-time-code')
        self.finish(self.client, params, 'failed')

    def test_foreign_origin_cannot_start_or_consume_flow(self):
        foreign = {'HTTP_ORIGIN': 'https://other.example.test'}
        result = self.client.post(BASE + '/start', {'mode': 'login'}, format='json', **foreign)
        self.assertEqual(result.status_code, 403)
        params = self.start(self.client, 'login')
        self.callback(self.client, params, error='access_denied')
        self.assertEqual(self.submit_finish(self.client, params, **foreign).status_code, 403)
        result = self.submit_finish(self.client, params, HTTP_ORIGIN='https://arti.example.test')
        self.assertEqual(result.data['status'], 'cancelled')

    def test_guest_flow_cannot_overwrite_session_and_dormant_or_admin_cannot_log_in(self):
        KakaoIdentity.objects.create(client_id=CLIENT_ID, subject='123456789', account=self.account)
        params = self.start(self.client, 'login')
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.login(self.client, self.other)
        self.assertEqual(self.submit_finish(self.client, params).status_code, 409)
        self.assertEqual(self.client.post(BASE + '/start', {'mode': 'login'}, format='json').status_code, 400)
        self.client.credentials()
        for role, status in [('user', 'dormant'), ('admin', 'active')]:
            with self.subTest(role=role, status=status):
                Account.objects.filter(pk=self.account.pk).update(role=role, status=status)
                params = self.start(self.client, 'login')
                with self.provider(params):
                    self.callback(self.client, params, code='one-time-code')
                self.finish(self.client, params, 'unlinked')

    def test_old_completion_page_cannot_consume_new_callback_in_same_browser(self):
        KakaoIdentity.objects.create(client_id=CLIENT_ID, subject='123456789', account=self.account)
        first = self.start(self.client, 'login', returnTo='/')
        self.callback(self.client, first, error='access_denied')
        second = self.start(self.client, 'login', returnTo='/mypage')
        with self.provider(second):
            self.callback(self.client, second, code='one-time-code')
        self.assertEqual(self.submit_finish(self.client, first).status_code, 400)
        self.assertEqual(self.client.post(BASE + '/finish').status_code, 400)
        self.assertFalse(Session.objects.exists())
        result = self.finish(self.client, second, 'logged_in')
        self.assertEqual(result['returnTo'], '/mypage')

    def test_no_secrets_or_https_callback_disables_oauth(self):
        for override in (
            {'ARTI_KAKAO_CLIENT_SECRET': ''},
            {'ARTI_KAKAO_CALLBACK_URL': CALLBACK.replace('https:', 'http:')},
            {'ARTI_KAKAO_CALLBACK_URL': CALLBACK.replace('.test/', '.test:invalid/')},
            {'ARTI_KAKAO_CALLBACK_URL': CALLBACK.replace('.test/', '.test:0/')},
        ):
            with override_settings(**override):
                self.assertEqual(self.client.get(BASE + '/status').data, {'enabled': False, 'linked': False})
                self.assertEqual(self.client.post(BASE + '/start', {'mode': 'login'}, format='json').status_code, 404)
        self.assertFalse(KakaoOAuthFlow.objects.exists())

    def test_default_https_callback_port_uses_the_browser_origin(self):
        callback = CALLBACK.replace('.test/', '.test:443/')
        with override_settings(ARTI_KAKAO_CALLBACK_URL=callback):
            response = self.client.post(BASE + '/start', {'mode': 'login'}, format='json',
                                        HTTP_ORIGIN='https://arti.example.test')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(parse_qs(urlsplit(response.data['authorizationUrl']).query)['redirect_uri'], [callback])
