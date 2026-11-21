from cryptography.fernet import Fernet
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from arti.http import ContractError
from arti.llm import text_connection_settings
from arti.member import issue
from arti.models import Account, AdminOpenAISettings, OperationEvent
from arti.openai_settings import voice_key


SETTINGS = '/api/admin/ai-settings'
FIRST_PROJECT_KEY = 'sk-fixture-first-project-0000'
SECOND_PROJECT_KEY = 'sk-fixture-second-project-0000'


@override_settings(
    ARTI_ENV='test', ARTI_AI_SETTINGS_ENCRYPTION_KEY=Fernet.generate_key().decode('ascii'),
    ARTI_LLM_PROVIDER='openai_compatible', OPENAI_BASE_URL='https://api.openai.com/v1',
    OPENAI_MODEL='gpt-6-luna', OPENAI_API_KEY='sk-environment-fixture-0000',
    ARTI_LLM_MODELS={'answer': 'gpt-6-luna'},
)
class AdminOpenAISettingsTests(TestCase):
    def setUp(self):
        admin = Account.objects.create(role='admin', login_id='settings-admin', nickname='관리자')
        member = Account.objects.create(role='user', login_id='settings@example.test', email='settings@example.test')
        self.admin_token = issue(admin).data['token']
        self.member_token = issue(member).data['token']
        self.client = APIClient(HTTP_HOST='localhost', HTTP_X_ADMIN_TOKEN=self.admin_token)
        self.payload = {'model': 'gpt-6-luna', 'enabled': True, 'revision': 0, 'apiKey': FIRST_PROJECT_KEY}

    def put(self, **changes):
        return self.client.put(SETTINGS, {**self.payload, **changes}, format='json')

    def test_admin_role_required_and_key_never_returned(self):
        for other in (
            APIClient(HTTP_HOST='localhost'),
            APIClient(HTTP_HOST='localhost', HTTP_AUTHORIZATION='Bearer ' + self.member_token),
            APIClient(HTTP_HOST='localhost', HTTP_X_ADMIN_TOKEN=self.member_token),
        ):
            self.assertEqual(other.get(SETTINGS).status_code, 401)
            self.assertEqual(other.put(SETTINGS, self.payload, format='json').status_code, 401)
        initial = self.client.get(SETTINGS)
        self.assertEqual(initial.json()['keyStatus'], 'environment')
        self.assertEqual(initial.headers['Cache-Control'], 'no-store')
        self.assertNotIn(b'sk-', initial.content)
        saved = self.put()
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()['keyStatus'], 'saved')
        self.assertNotIn(b'sk-', saved.content)
        self.assertNotIn(b'sk-', self.client.get(SETTINGS).content)
        self.assertNotIn(FIRST_PROJECT_KEY.encode(), bytes(AdminOpenAISettings.objects.get().encrypted_key))
        self.assertTrue(OperationEvent.objects.filter(action='ai_settings_save', status=200).exists())

    def test_effective_rotation_revision_and_disabled_override(self):
        self.assertEqual(self.put().json()['revision'], 1)
        self.assertEqual(text_connection_settings('answer')[1:3], (FIRST_PROJECT_KEY, 'gpt-6-luna'))
        self.assertEqual(voice_key(), FIRST_PROJECT_KEY)
        self.assertEqual(self.put(apiKey=SECOND_PROJECT_KEY).status_code, 409)
        self.assertEqual(text_connection_settings('answer')[1], FIRST_PROJECT_KEY)
        self.assertEqual(self.put(revision=1, apiKey='', model='gpt-6-test-model').status_code, 200)
        self.assertEqual(text_connection_settings('answer')[1:3], (FIRST_PROJECT_KEY, 'gpt-6-test-model'))
        self.assertEqual(self.put(revision=2, apiKey=SECOND_PROJECT_KEY).status_code, 200)
        self.assertEqual(text_connection_settings('answer')[1], SECOND_PROJECT_KEY)
        self.assertEqual(self.put(revision=3, enabled=False, apiKey='').status_code, 200)
        self.assertEqual(voice_key(), '')
        with self.assertRaises(ContractError):
            text_connection_settings('answer')

    def test_insecure_production_and_custom_connection_do_not_accept_secrets(self):
        with override_settings(ARTI_ENV='production'):
            self.assertEqual(self.put().status_code, 403)
            self.assertFalse(AdminOpenAISettings.objects.exists())
            response = self.client.put(SETTINGS, self.payload, format='json', secure=True)
            self.assertEqual(response.status_code, 200)
        with override_settings(OPENAI_BASE_URL='https://provider.example.test/v1'):
            self.assertFalse(self.client.get(SETTINGS).json()['editable'])
            self.assertEqual(self.put(revision=1).status_code, 503)
            self.assertEqual(text_connection_settings('answer')[1], 'sk-environment-fixture-0000')

    def test_does_not_fall_back_to_environment_on_unreadable_saved_key(self):
        self.assertEqual(self.put().status_code, 200)
        with override_settings(ARTI_AI_SETTINGS_ENCRYPTION_KEY=Fernet.generate_key().decode('ascii')):
            self.assertEqual(self.client.get(SETTINGS).json()['keyStatus'], 'unreadable')
            self.assertEqual(voice_key(), '')
            with self.assertRaises(ContractError):
                text_connection_settings('answer')
            self.assertEqual(self.put(revision=1, apiKey=SECOND_PROJECT_KEY).status_code, 200)
            self.assertEqual(text_connection_settings('answer')[1], SECOND_PROJECT_KEY)

    def test_validation_does_not_echo_a_bad_key(self):
        bad_key = 'secret-containing spaces'
        invalid = self.put(apiKey=bad_key)
        self.assertEqual(invalid.status_code, 400)
        self.assertNotIn(bad_key.encode(), invalid.content)
        with override_settings(OPENAI_API_KEY=''):
            self.assertEqual(self.put(apiKey='').json()['code'], 'API_KEY_REQUIRED')
            self.assertFalse(AdminOpenAISettings.objects.exists())
