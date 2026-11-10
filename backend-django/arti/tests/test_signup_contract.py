# 닉네임 선택 입력과 비밀번호 오류 분리 계약을 검증합니다.
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient
from arti.models import Account


class SignupContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(HTTP_HOST='localhost')

    def signup(self, **changes):
        return self.client.post('/api/auth/signup', {
            'email': 'review@example.test', 'password': 'valid-password123', **changes
        }, format='json')

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
