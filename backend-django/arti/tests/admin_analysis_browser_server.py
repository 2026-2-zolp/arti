"""Serve Django and an isolated HTTP analysis fixture for the administrator Chrome test."""

import base64
import hashlib
import json
import re
import sys
from threading import Event, Thread
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from arti.tests.test_model_service import result
from arti.tests.test_provider import endpoint


def serve():
    database = settings.DATABASES['default']
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not re.fullmatch(r'arti_admin_analysis(?:_[a-z0-9_]{1,40})?', database['NAME'])
            or database['HOST'] not in ('127.0.0.1', 'localhost')
            or settings.ARTI_LLM_PROVIDER != 'disabled' or settings.ARTI_MODEL_SERVICE_URL):
        raise RuntimeError('Use a dedicated loopback admin analysis fixture DB with model providers disabled.')

    release = Event()
    inputs = []

    def respond(attempt):
        request = requests[attempt - 1]
        payload = request['body']
        text_fields = {'title', 'description'}
        if request['path'] != '/analyze' or set(payload) not in (text_fields, text_fields | {'imageBase64'}):
            return 400, b'unexpected analysis wire format'
        image = None
        if 'imageBase64' in payload:
            try:
                image = hashlib.sha256(base64.b64decode(payload['imageBase64'], validate=True)).hexdigest()
            except (TypeError, ValueError):
                return 400, b'invalid image bytes'
        inputs.append({
            'title': hashlib.sha256(payload['title'].encode()).hexdigest(),
            'source': hashlib.sha256(payload['description'].encode()).hexdigest(),
            'image': image,
        })
        if attempt == 1 and not release.wait(20):
            return 504, b'synthetic analysis gate expired'
        mock = result()
        mock.update(usedImage=image is not None, tagSource='image' if image is not None else 'text')
        mock['emotions']['calm'] = .2 if attempt == 1 else .8
        return 200, json.dumps(mock).encode()

    application = get_wsgi_application()

    def mock_application(environ, start_response):
        def mark(status, headers, exc_info=None):
            return start_response(status, [*headers, ('X-Arti-Admin-Analysis-Mock', '1')], exc_info)

        if environ['PATH_INFO'] == '/api/__admin_analysis_test__/gate':
            if environ['REQUEST_METHOD'] == 'POST':
                release.set()
            body = json.dumps({'inputs': inputs}).encode()
            mark('200 OK', [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
            return [body]
        return application(environ, mark)

    with endpoint(respond=respond) as requests, override_settings(
        ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1'),
    ), make_server('127.0.0.1', 0, mock_application, ThreadedWSGIServer, WSGIRequestHandler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            print(f'ARTI_ADMIN_ANALYSIS_BROWSER_PORT={server.server_port}', flush=True)
            sys.stdin.buffer.read()
        finally:
            release.set()
            server.shutdown()
            worker.join()
