from urllib.parse import urlsplit

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.http.request import validate_host

from arti.http import ContractError
from arti import kakao
from arti.llm import DRAFT_TASKS, text_connection_settings
from arti.password_reset import reset_enabled


def https_origin(value):
    try:
        origin = urlsplit(value)
        port = origin.port
    except ValueError:
        return False
    return (origin.scheme == 'https' and origin.hostname and not origin.username and not origin.password
            and not (origin.path or origin.query or origin.fragment) and port != 0)


def model_ready(feature):
    try:
        routes = [text_connection_settings(task) for task in DRAFT_TASKS]
    except ContractError:
        return False
    if feature == 'luna':
        return settings.ARTI_DRAFT_PROVIDER == 'default' and all(
            base == 'https://api.openai.com/v1' and model == 'gpt-6-luna' for base, _, model, _, _ in routes)
    return settings.ARTI_DRAFT_PROVIDER == 'openai_compatible' and all(
        model.startswith('kakaocorp/kanana') for _, _, model, _, _ in routes)


def mail_ready(origin):
    return (settings.ARTI_PASSWORD_RESET_ORIGIN == origin and reset_enabled()
            and settings.EMAIL_BACKEND == 'django.core.mail.backends.smtp.EmailBackend'
            and settings.EMAIL_HOST.strip().lower() not in ('', 'localhost', '127.0.0.1', '::1')
            and 0 < settings.EMAIL_PORT < 65536 and settings.EMAIL_USE_TLS != settings.EMAIL_USE_SSL
            and bool(settings.EMAIL_HOST_USER) == bool(settings.EMAIL_HOST_PASSWORD))


class Command(BaseCommand):
    help = 'Check selected trial configuration from Django settings without network or credentials in output.'

    def add_arguments(self, parser):
        parser.add_argument('feature', choices=('luna', 'kanana', 'mail', 'kakao'))
        parser.add_argument('--origin', help='Browser HTTPS origin for the mail or Kakao rehearsal')

    def handle(self, *args, **options):
        feature = options['feature']
        origin = (options['origin'] or '').rstrip('/')
        if feature in ('mail', 'kakao'):
            if not https_origin(origin):
                raise CommandError('Provide the browser HTTPS origin with --origin (no path).')
            if not validate_host(urlsplit(origin).hostname, settings.ALLOWED_HOSTS):
                raise CommandError('Add the trial hostname to DJANGO_ALLOWED_HOSTS.')
        if feature in ('luna', 'kanana'):
            valid = model_ready(feature)
            action = 'Check the effective A-04 draft provider, base URL, API key and model.'
        elif feature == 'mail':
            valid = mail_ready(origin)
            action = 'Check the reset origin, sender, SMTP host, credentials and TLS mode.'
        else:
            valid = kakao.configured_origin() == kakao.browser_origin(urlsplit(origin))
            action = 'Check the Kakao REST key, client secret and exact callback URL.'
        if not valid:
            raise CommandError(action)
        self.stdout.write(self.style.SUCCESS(f'{feature}: settings match (no external requests)'))
