"""Serve Django with a local receipt interpretation provider for the Chrome regression."""

import json
from http.server import ThreadingHTTPServer
from threading import Event, Lock
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from arti.tests.test_provider import endpoint


def serve(port=5552):
    database = settings.DATABASES['default']
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or database['NAME'] != 'arti_receipt_interpret'
            or database['HOST'] not in ('127.0.0.1', 'localhost')
            or settings.ARTI_LLM_PROVIDER != 'disabled' or settings.ARTI_DRAFT_PROVIDER != 'default'
            or settings.ARTI_MODEL_SERVICE_URL):
        raise RuntimeError('Use the isolated loopback receipt test database with models disabled.')

    application = get_wsgi_application()
    attempts = {}
    attempts_lock = Lock()
    race_gates = {round_id: (Event(), Event()) for round_id in ('1', '2')}
    race_texts = {
        0: '두 탭 검수 기준 해석',
        1: '먼저 요청하고 늦게 도착한 모의 해석',
        2: '나중에 요청하고 먼저 도착한 모의 해석',
        3: '다른 탭 요청이 실패한 뒤 도착한 모의 해석',
    }

    def respond(attempt):
        wire = requests[attempt - 1]
        prompt = json.loads(wire['body']['messages'][1]['content'])['artworkData']
        dwell = prompt['dwell'].get('fixture-art01')
        if (set(prompt) != {'artworks', 'reactions', 'dwell'} or dwell not in (21, 29, 37)
                or [art['id'] for art in prompt['artworks']] != ['fixture-art01']):
            return 400, b'unexpected synthetic receipt context'

        with attempts_lock:
            first, count = attempts.get(dwell, (wire['raw'], 0))
            attempts[dwell] = (first, count + 1)
        if first != wire['raw']:
            return 400, b'retry must preserve the provider request'
        if count == (4 if dwell == 37 else 1):
            return 500, b'upstream-private-debug'
        if dwell == 37 and count in (1, 3):
            started, release = race_gates['1' if count == 1 else '2']
            started.set()
            if not release.wait(16):
                return 504, b'synthetic receipt gate expired'
        texts = race_texts if dwell == 37 else {
            0: '기존 모의 감상 해석',
            2: '재시도에 성공한 모의 감상 해석',
            3: '계정 전환 뒤에 도착한 모의 감상 해석',
        }
        if count not in texts:
            return 400, b'unexpected synthetic provider call'
        response = {'choices': [{
            'finish_reason': 'stop', 'message': {'content': json.dumps({'text': texts[count]})},
        }]}
        return 200, json.dumps(response).encode()

    def mock_application(environ, start_response):
        def mark(status, headers, exc_info=None):
            return start_response(status, [*headers, ('X-Arti-Receipt-Mock', '1')], exc_info)

        prefix = '/api/__receipt_interpret_test__/gate/'
        path = environ['PATH_INFO']
        if path.startswith(prefix) and (gate := race_gates.get(path.removeprefix(prefix))):
            started, release = gate
            if environ['REQUEST_METHOD'] == 'POST':
                release.set()
            body = json.dumps({'started': started.is_set()}).encode()
            mark('200 OK', [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
            return [body]
        return application(environ, mark)

    with override_settings(
        ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-receipt-browser-only',
        OPENAI_MODEL='synthetic-receipt-browser-only', ARTI_LLM_MODELS={},
        ARTI_LLM_TOKEN_PARAMETER='max_completion_tokens', ARTI_LLM_JSON_MODE=True,
    ), endpoint(respond=respond, server_class=ThreadingHTTPServer) as requests, make_server(
        '127.0.0.1', port, mock_application, ThreadedWSGIServer, WSGIRequestHandler,
    ) as server:
        server.serve_forever()
