"""Serve Django and an isolated HTTP analysis fixture for the administrator Chrome test."""

import base64
import hashlib
import json
import re
import sys
from threading import Event, Thread
from unittest.mock import patch
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from arti import providers
from arti.http import ContractError
from arti.tests.test_model_service import result
from arti.tests.test_provider import endpoint


def serve():
    database = settings.DATABASES['default']
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not re.fullmatch(r'arti_admin_analysis(?:_[a-z0-9_]{1,40})?', database['NAME'])
            or database['HOST'] not in ('127.0.0.1', 'localhost')
            or settings.ARTI_LLM_PROVIDER != 'disabled' or settings.ARTI_DRAFT_PROVIDER != 'default'
            or settings.ARTI_MODEL_SERVICE_URL):
        raise RuntimeError('Use a dedicated loopback admin analysis fixture DB with model providers disabled.')

    release = Event()
    inputs = []
    regeneration = Event()
    release_regeneration = Event()
    text_requests = []
    original_generate = providers.generate

    def generate(kind, snapshot, **context):
        if not regeneration.is_set() or kind not in ('summary', 'guide', 'answer'):
            return original_generate(kind, snapshot, **context)
        if kind == 'answer':
            return {'answer': (context['entry'].get('text') or context['entry']['question'])}
        text_requests.append(kind)
        if kind == 'summary':
            if not release_regeneration.wait(20):
                raise ContractError(504, 'AI_TIMEOUT', '시험 재생성 대기 시간 초과')
            return {'summary': '새 요약 제안입니다.', 'keywords': ['합성']}
        if text_requests.count('guide') == 1:
            return {'intro': '힌트 개수 검수용 도입', 'questions': ['관찰 질문'], 'hints': []}
        return {'intro': '새 가이드 도입입니다.', 'questions': ['새 관찰 질문입니다.'], 'hints': ['새 힌트입니다.']}

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
                phase = environ['QUERY_STRING']
                if phase == 'regeneration=start':
                    regeneration.set()
                elif phase == 'regeneration=release':
                    release_regeneration.set()
                else:
                    release.set()
            body = json.dumps({'inputs': inputs, 'textRequests': text_requests}).encode()
            mark('200 OK', [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
            return [body]
        return application(environ, mark)

    with endpoint(respond=respond) as requests, override_settings(
        ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1'),
    ), patch('arti.providers.generate', side_effect=generate), make_server(
        '127.0.0.1', 0, mock_application, ThreadedWSGIServer, WSGIRequestHandler,
    ) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            print(f'ARTI_ADMIN_ANALYSIS_BROWSER_PORT={server.server_port}', flush=True)
            sys.stdin.buffer.read()
        finally:
            release.set()
            release_regeneration.set()
            server.shutdown()
            worker.join()
