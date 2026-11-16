"""Serve real Django Kakao routes with a signed, synthetic OIDC provider."""

import atexit
import base64
import hashlib
import json
import os
import re
import sys
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from ipaddress import IPv4Address
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.parse import parse_qs
from uuid import uuid4
from wsgiref.simple_server import make_server

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

class QuietRequestHandler(WSGIRequestHandler):
    def log_message(self, _format, *_args):
        # Even the synthetic front-channel code and state stay out of the transcript.
        pass


def write_certificate(directory):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, '127.0.0.1')])
    now = datetime.now(UTC)
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(hours=1))
                   .add_extension(x509.SubjectAlternativeName([x509.IPAddress(IPv4Address('127.0.0.1'))]),
                                  critical=False)
                   .sign(key, hashes.SHA256()))
    (directory / 'key.pem').write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (directory / 'cert.pem').write_bytes(certificate.public_bytes(serialization.Encoding.PEM))


@contextmanager
def mock_wsgi(https_port):
    database = settings.DATABASES['default']
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not re.fullmatch(r'arti_kakao_browser(?:_[a-z0-9_]{1,40})?', database['NAME'])
            or database['HOST'] not in ('127.0.0.1', 'localhost')
            or settings.ARTI_LLM_PROVIDER != 'disabled' or settings.ARTI_DRAFT_PROVIDER != 'default' or settings.ARTI_MODEL_SERVICE_URL
            or any((settings.ARTI_KAKAO_CLIENT_ID, settings.ARTI_KAKAO_CLIENT_SECRET,
                    settings.ARTI_KAKAO_CALLBACK_URL))):
        raise RuntimeError('Use an isolated loopback test DB with real Kakao and model settings disabled.')

    application = get_wsgi_application()
    from arti import kakao
    from arti.kakao_auth import digest
    from arti.models import KakaoOAuthFlow
    from arti.tests.test_kakao_auth import CLIENT_ID, signed_identity, signing_material

    callback_url = f'https://127.0.0.1:{int(https_port)}{kakao.CALLBACK_PATH}'
    key, jwk = signing_material()
    subject = str(uuid4().int)
    def provider(request):
        if request.full_url == kakao.ISSUER + '/.well-known/jwks.json':
            assert request.get_method() == 'GET'
            return {'keys': [jwk]}
        assert request.full_url == kakao.ISSUER + '/oauth/token' and request.get_method() == 'POST'
        fields = parse_qs(request.data.decode(), strict_parsing=True)
        assert fields['grant_type'] == ['authorization_code'] and fields['client_id'] == [CLIENT_ID]
        assert fields['client_secret'] == ['synthetic-browser-secret'] and fields['redirect_uri'] == [callback_url]
        code = fields['code'][0]
        authorization = json.loads(base64.urlsafe_b64decode(code + '=' * (-len(code) % 4)))
        verifier = fields['code_verifier'][0]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        flow = KakaoOAuthFlow.objects.get(state_hash=digest(authorization['state']), status='exchanging')
        assert challenge == authorization['challenge'] and flow.nonce == authorization['nonce']
        return {'id_token': signed_identity(key, jwk, authorization['nonce'], subject)}

    def mock_application(environ, start_response):
        def mark(status, headers, exc_info=None):
            return start_response(status, [*headers, ('X-Arti-Kakao-Mock', '1')], exc_info)
        return application(environ, mark)

    with override_settings(
        ARTI_KAKAO_CLIENT_ID=CLIENT_ID, ARTI_KAKAO_CLIENT_SECRET='synthetic-browser-secret',
        ARTI_KAKAO_CALLBACK_URL=callback_url, ARTI_TASTE_PROFILE_V2_ENABLED=True,
    ), patch('arti.kakao.request_json', side_effect=provider):
        yield mock_application


def create_gunicorn_application():
    mock = mock_wsgi(int(os.environ['ARTI_KAKAO_BROWSER_PORT']))
    application = mock.__enter__()
    atexit.register(mock.__exit__, None, None, None)
    return application


def serve(https_port):
    with mock_wsgi(https_port) as application, make_server(
        '127.0.0.1', 0, application, ThreadedWSGIServer, QuietRequestHandler,
    ) as server:
        write_certificate(Path(os.environ['ARTI_KAKAO_BROWSER_TLS_DIR']))
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            print(f'ARTI_KAKAO_BROWSER_API_PORT={server.server_port}', flush=True)
            sys.stdin.buffer.read()
        finally:
            server.shutdown()
            worker.join()
