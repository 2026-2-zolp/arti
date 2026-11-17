"""A fresh loopback Django process for each visit Chrome run."""

import json
import re
import sys
from threading import Thread
from unittest.mock import patch
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core import mail
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings


def require_visit_fixture():
    database = settings.DATABASES['default']
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not re.fullmatch(r'arti_visit_boundaries(?:_[a-z0-9_]{1,40})?', database['NAME'])
            or database['HOST'] not in ('127.0.0.1', 'localhost')
            or settings.ARTI_LLM_PROVIDER != 'disabled' or settings.ARTI_DRAFT_PROVIDER != 'default'
            or settings.ARTI_MODEL_SERVICE_URL):
        raise RuntimeError('Use a dedicated loopback visit fixture DB with both model providers disabled.')


def serve(suite=None):
    require_visit_fixture()
    if suite == 'password-reset':
        with override_settings(ARTI_PASSWORD_RESET_ORIGIN='http://127.0.0.1:1',
                               ARTI_PASSWORD_RESET_FROM='reset@example.test',
                               EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'):
            return run_loopback(reset_mail_application())
    if suite == 'operations':
        from arti import providers
        from arti.http import ContractError

        original = providers.generate

        def generate(kind, snapshot, **context):
            if kind == 'summary':
                return {'summary': '합성 운영 로그 요약', 'keywords': []}
            if kind == 'guide':
                raise ContractError(502, 'PROVIDER_ERROR', '합성 운영 로그 검수 세부 정보')
            return original(kind, snapshot, **context)

        with patch('arti.providers.generate', side_effect=generate):
            return run_loopback(get_wsgi_application())
    run_loopback(get_wsgi_application())


def reset_mail_application():
    from arti.password_reset import deliver_pending

    application = get_wsgi_application()
    mail.get_connection()

    def inbox(environ, start_response):
        if (environ.get('PATH_INFO') != '/api/__test__/reset-inbox'
                or environ.get('REQUEST_METHOD') != 'POST'):
            return application(environ, start_response)
        deliver_pending()
        links = [re.search(r'/password/reset#token=[a-f0-9.]+', message.body).group(0) for message in mail.outbox]
        start_response('200 OK', [('Content-Type', 'application/json'), ('Cache-Control', 'no-store')])
        return [json.dumps(links).encode()]

    return inbox


def run_loopback(application):
    with make_server('127.0.0.1', 0, application,
                     ThreadedWSGIServer, WSGIRequestHandler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            print(f'ARTI_VISIT_BROWSER_PORT={server.server_port}', flush=True)
            # The runner owns this process through the pipe, including on Windows.
            sys.stdin.buffer.read()
        finally:
            server.shutdown()
            worker.join()
