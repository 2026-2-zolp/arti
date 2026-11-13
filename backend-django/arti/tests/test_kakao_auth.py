import base64
import hashlib
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti import kakao
from arti.kakao_auth import COMPLETE_PATH, COOKIE_PATH, FLOW_COOKIE
from arti.models import Account, Exhibition, KakaoIdentity, KakaoOAuthFlow, Session, Visit

CLIENT_ID = 'test-kakao-app'
CALLBACK = 'https://arti.example.test/api/auth/kakao/callback'
PASSWORD = 'demo-password1'
BASE = '/api/auth/kakao'


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
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk = jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key(), as_dict=True)
        cls.jwk.update(kid='test-signing-key', use='sig', alg='RS256')

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
        now = timezone.now()
        claims = {'iss': kakao.ISSUER, 'aud': CLIENT_ID, 'sub': subject, 'iat': now,
                  'exp': now + timedelta(minutes=5), 'nonce': params['nonce'], 'email': self.account.email,
                  **overrides}

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
            return {'id_token': jwt.encode(claims, key or self.key, algorithm='RS256',
                                           headers={'kid': self.jwk['kid']}),
                    'access_token': 'unused-access-token', 'refresh_token': 'unused-refresh-token'}

        return patch('arti.kakao.request_json', side_effect=response)

    def callback(self, browser, params, **query):
        response = browser.get(BASE + '/callback', {'state': params['state'], **query})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], COMPLETE_PATH)
        self.assertEqual(response['Referrer-Policy'], 'no-referrer')
        self.assertIn('no-store', response['Cache-Control'])

    def finish(self, browser, status):
        response = browser.post(BASE + '/finish')
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
            self.callback(self.client, link, code='one-time-code')
            self.assertEqual(provider.call_count, 2)
        flow = KakaoOAuthFlow.objects.get()
        self.assertEqual((flow.nonce, flow.verifier), ('', ''))
        self.assertEqual(self.finish(self.client, 'linked'), {'status': 'linked', 'returnTo': '/mypage'})
        self.assertEqual(self.client.get(BASE + '/status').data, {'enabled': True, 'linked': True})
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 204)
        self.client.credentials()

        target = '/exhibitions/real-exhibition/taste/saved'
        login = self.start(self.client, 'login', returnTo=target)
        with self.provider(login):
            self.callback(self.client, login, code='one-time-code')
        result = self.finish(self.client, 'logged_in')
        self.assertEqual(result['returnTo'], target)
        self.assertEqual(result['user']['id'], self.account.pk)
        self.assertEqual(result['user']['tastes'], self.account.tastes)
        self.assertNotEqual(result['token'], original_token)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + result['token'])
        self.assertEqual(self.client.get('/api/auth/me').data['id'], self.account.pk)
        records = self.client.get(f'/api/users/{self.account.pk}/visits')
        self.assertEqual([record['id'] for record in records.data], [visit.pk])
        self.assertEqual(self.client.post(BASE + '/finish').status_code, 400)
        self.assertFalse(KakaoOAuthFlow.objects.exists())

    def test_matching_email_never_links_or_creates_accounts(self):
        params = self.start(self.client, 'login', returnTo='/%2fevil.example')
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.assertEqual(self.finish(self.client, 'unlinked'), {'status': 'unlinked', 'returnTo': '/'})
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
        self.assertEqual(self.client.post(BASE + '/finish').status_code, 403)
        self.login(self.client, self.account)
        self.assertEqual(self.client.post(BASE + '/finish').status_code, 403)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + first_token)
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 204)
        self.assertEqual(self.client.post(BASE + '/finish').status_code, 403)
        self.assertFalse(KakaoIdentity.objects.exists())

    def test_one_kakao_subject_cannot_be_linked_to_another_account(self):
        KakaoIdentity.objects.create(client_id=CLIENT_ID, subject='123456789', account=self.other)
        self.login(self.client, self.account)
        params = self.start(self.client, 'link', password=PASSWORD)
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.assertNotIn('token', self.finish(self.client, 'conflict'))
        self.assertEqual(KakaoIdentity.objects.get().account_id, self.other.pk)

    def test_state_is_bound_to_browser_and_expires(self):
        params = self.start(self.client, 'login')
        with patch('arti.kakao.request_json') as provider:
            self.callback(APIClient(), params, code='one-time-code')
            self.callback(self.client, {'state': 'x' * 43}, code='one-time-code')
            self.assertEqual(self.client.post(BASE + '/finish').status_code, 400)
            KakaoOAuthFlow.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
            self.callback(self.client, params, code='one-time-code')
            self.assertEqual(self.client.post(BASE + '/finish').status_code, 400)
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
                self.finish(self.client, 'failed')
        self.assertFalse(Session.objects.exists())

    def test_cancellation_and_provider_timeout_are_recoverable(self):
        params = self.start(self.client, 'login')
        with patch('arti.kakao.request_json') as provider:
            self.callback(self.client, params, error='access_denied')
            provider.assert_not_called()
        self.finish(self.client, 'cancelled')
        params = self.start(self.client, 'login')
        with patch('arti.kakao.request_json', side_effect=TimeoutError):
            self.callback(self.client, params, code='one-time-code')
        self.finish(self.client, 'failed')

    def test_foreign_origin_cannot_start_or_consume_flow(self):
        foreign = {'HTTP_ORIGIN': 'https://other.example.test'}
        result = self.client.post(BASE + '/start', {'mode': 'login'}, format='json', **foreign)
        self.assertEqual(result.status_code, 403)
        params = self.start(self.client, 'login')
        self.callback(self.client, params, error='access_denied')
        self.assertEqual(self.client.post(BASE + '/finish', **foreign).status_code, 403)
        result = self.client.post(BASE + '/finish', HTTP_ORIGIN='https://arti.example.test')
        self.assertEqual(result.data['status'], 'cancelled')

    def test_guest_flow_cannot_overwrite_session_and_dormant_or_admin_cannot_log_in(self):
        KakaoIdentity.objects.create(client_id=CLIENT_ID, subject='123456789', account=self.account)
        params = self.start(self.client, 'login')
        with self.provider(params):
            self.callback(self.client, params, code='one-time-code')
        self.login(self.client, self.other)
        self.assertEqual(self.client.post(BASE + '/finish').status_code, 409)
        self.assertEqual(self.client.post(BASE + '/start', {'mode': 'login'}, format='json').status_code, 400)
        self.client.credentials()
        for role, status in [('user', 'dormant'), ('admin', 'active')]:
            with self.subTest(role=role, status=status):
                Account.objects.filter(pk=self.account.pk).update(role=role, status=status)
                params = self.start(self.client, 'login')
                with self.provider(params):
                    self.callback(self.client, params, code='one-time-code')
                self.finish(self.client, 'unlinked')

    def test_no_secrets_or_https_callback_disables_oauth(self):
        for override in ({'ARTI_KAKAO_CLIENT_SECRET': ''}, {'ARTI_KAKAO_CALLBACK_URL': CALLBACK.replace('https:', 'http:')}):
            with override_settings(**override):
                self.assertEqual(self.client.get(BASE + '/status').data, {'enabled': False, 'linked': False})
                self.assertEqual(self.client.post(BASE + '/start', {'mode': 'login'}, format='json').status_code, 404)
        self.assertFalse(KakaoOAuthFlow.objects.exists())
