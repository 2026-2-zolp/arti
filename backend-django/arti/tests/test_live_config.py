from io import StringIO

from django.core.management import call_command, CommandError
from django.test import SimpleTestCase, override_settings


ORIGIN = 'https://stage.example.test'


@override_settings(ALLOWED_HOSTS=['stage.example.test'])
class LiveConfigTests(SimpleTestCase):
    @override_settings(ARTI_KAKAO_CLIENT_ID='fixture-client', ARTI_KAKAO_CLIENT_SECRET='fixture-kakao-secret',
                       ARTI_KAKAO_CALLBACK_URL=ORIGIN + '/api/auth/kakao/callback')
    def test_kakao_checks_the_browser_origin_without_printing_credentials(self):
        output = StringIO()
        call_command('check_live_config', 'kakao', '--origin', ORIGIN, stdout=output)
        self.assertEqual(output.getvalue(), 'kakao: settings match (no external requests)\n')
        with self.assertRaisesMessage(CommandError, 'DJANGO_ALLOWED_HOSTS'):
            call_command('check_live_config', 'kakao', '--origin', 'https://other.example.test')
        with self.assertRaisesMessage(CommandError, 'exact callback'):
            call_command('check_live_config', 'kakao', '--origin', ORIGIN + ':8443')
        with self.settings(ARTI_KAKAO_CALLBACK_URL=ORIGIN + ':443/api/auth/kakao/callback'):
            output = StringIO()
            call_command('check_live_config', 'kakao', '--origin', ORIGIN, stdout=output)
            self.assertEqual(output.getvalue(), 'kakao: settings match (no external requests)\n')

    @override_settings(ARTI_PASSWORD_RESET_ORIGIN=ORIGIN, ARTI_PASSWORD_RESET_FROM='fixture@example.test',
                       EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend', EMAIL_HOST='smtp.example.test',
                       EMAIL_PORT=465, EMAIL_HOST_USER='fixture-user', EMAIL_HOST_PASSWORD='fixture-mail-secret',
                       EMAIL_USE_TLS=False, EMAIL_USE_SSL=True)
    def test_mail_rejects_loopback_and_conflicting_tls(self):
        output = StringIO()
        call_command('check_live_config', 'mail', '--origin', ORIGIN, stdout=output)
        self.assertEqual(output.getvalue(), 'mail: settings match (no external requests)\n')
        for override in ({'EMAIL_HOST': 'localhost'}, {'EMAIL_USE_TLS': True}, {'EMAIL_HOST_PASSWORD': ''}):
            with self.settings(**override), self.assertRaisesMessage(CommandError, 'SMTP host'):
                call_command('check_live_config', 'mail', '--origin', ORIGIN)

    @override_settings(ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='fixture-model-secret',
                       OPENAI_BASE_URL='https://api.openai.com/v1', OPENAI_MODEL='gpt-6-luna', ARTI_LLM_MODELS={},
                       ARTI_DRAFT_PROVIDER='default')
    def test_model_requires_the_effective_summary_and_guide_routes(self):
        output = StringIO()
        call_command('check_live_config', 'luna', stdout=output)
        self.assertEqual(output.getvalue(), 'luna: settings match (no external requests)\n')
        with self.settings(ARTI_LLM_MODELS={'guide': 'other'}), self.assertRaisesMessage(CommandError, 'A-04'):
            call_command('check_live_config', 'luna')
        with self.settings(ARTI_DRAFT_PROVIDER='openai_compatible',
                           ARTI_DRAFT_MODEL='kakaocorp/kanana-2-3b-instruct', ARTI_DRAFT_API_KEY='fixture-draft-secret',
                           ARTI_DRAFT_BASE_URL='http://127.0.0.1:8010/v1'):
            output = StringIO()
            call_command('check_live_config', 'kanana', stdout=output)
            self.assertEqual(output.getvalue(), 'kanana: settings match (no external requests)\n')
            with self.settings(ARTI_DRAFT_BASE_URL='http://host.docker.internal:8010/v1'):
                with self.assertRaisesMessage(CommandError, 'A-04'):
                    call_command('check_live_config', 'kanana')
