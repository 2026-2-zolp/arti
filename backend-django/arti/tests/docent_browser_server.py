"""Serve the product API with a loopback-only docent provider for browser tests."""

import json
import os
from threading import Event, Lock
from time import sleep
from uuid import UUID
from unittest.mock import patch
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from arti.tests.test_provider import endpoint


GUIDE_HINT_REQUEST = '이 관찰 질문에 답할 수 있도록 작품에서 볼 지점 하나를 힌트로 알려 주세요.'
EVIDENCE_QUESTION = '[합성 근거 부족] 이 작품을 그리던 날 작가에게 어떤 사건이 있었나요?'


def serve(host='0.0.0.0'):
    if settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES:
        raise RuntimeError('Use an isolated ARTI test database with synthetic fixtures.')

    pending = {}
    faults = {'502': 500, '429': 429, '504': 200}
    races = os.environ.get('ARTI_DOCENT_RACE_TESTS') == '1'
    entries = os.environ.get('ARTI_DOCENT_ENTRY_TESTS') == '1'
    gates = {}
    gates_lock = Lock()

    def gate_for(value):
        key = str(UUID(value))
        with gates_lock:
            return gates.setdefault(key, (Event(), Event()))

    def respond(attempt):
        wire = requests[attempt - 1]
        prompt = json.loads(wire['body']['messages'][1]['content'])
        question = prompt.get('question') or ''
        entry = prompt.get('entry') or {}
        parts = question.split(' ', 3)
        fault = parts[1] if len(parts) == 4 and parts[0] == '[합성' else ''
        retry_key = question
        if entries and question == GUIDE_HINT_REQUEST:
            fault = '502'
            retry_key = question, entry.get('question')
        if fault in faults:
            previous = pending.pop(retry_key, None)
            if previous is None:
                pending[retry_key] = wire['raw']
                if fault == '504':
                    sleep(1.5)  # The real HTTP read exceeds the shortened adapter timeout.
                else:
                    return faults[fault], b'upstream-private-debug'
            elif previous != wire['raw']:
                return 400, b'the provider retry did not preserve the original prompt'

        unsupported = question == EVIDENCE_QUESTION
        text = '합성 답변입니다. 밝은 부분을 살펴보세요. <img src=x>'
        if entries and entry.get('kind') in ('guide', 'summary'):
            text = '합성 근거 · ' + (entry.get('question') or entry['text'])
        if races and len(parts) == 4 and parts[:2] == ['[합성', '대기']:
            started, release = gate_for(parts[2])
            started.set()
            try:
                if not release.wait(20):
                    return 500, b'synthetic gate expired'
            finally:
                with gates_lock:
                    gates.pop(parts[2], None)
            text = f'합성 지연 답변 · {prompt["artworkData"]["description"]}'
        answer = {
            'answer': '다른 합성 작품에 기록된 사건 때문에 제작했습니다.' if unsupported else text,
            'insufficientEvidence': unsupported,
            'sourceRefs': [
                {'artworkId': prompt['artworkData']['id'], 'kind': 'summary', 'sourceVersion': 99, 'revision': 99},
                {'artworkId': 'fixture-art02', 'kind': 'guide', 'sourceVersion': 1, 'revision': 1},
                {'artworkId': 'forged-work', 'kind': 'summary'},
            ],
        }
        response = {'choices': [{
            'finish_reason': 'stop', 'message': {'content': json.dumps(answer, ensure_ascii=False)},
        }]}
        return 200, json.dumps(response, ensure_ascii=False).encode()

    application = get_wsgi_application()

    def mock_application(environ, start_response):
        def mark(status, headers, exc_info=None):
            return start_response(status, [*headers, ('X-Arti-Docent-Mock', '1')], exc_info)

        prefix = '/api/__docent_test__/gate/'
        if races and environ['PATH_INFO'].startswith(prefix):
            try:
                started, release = gate_for(environ['PATH_INFO'][len(prefix):])
            except ValueError:
                mark('404 Not Found', [('Content-Length', '0')])
                return [b'']
            if environ['REQUEST_METHOD'] == 'POST':
                release.set()
            body = json.dumps({'started': started.is_set(), 'released': release.is_set()}).encode()
            mark('200 OK', [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
            return [body]
        return application(environ, mark)

    with override_settings(
        ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-browser-only',
        OPENAI_MODEL='synthetic-browser-only', ARTI_LLM_MODELS={}, ARTI_MODEL_SERVICE_URL='',
    ), endpoint(respond=respond) as requests, patch('arti.llm.TIMEOUT_SECONDS', 22 if races else 1), make_server(
        host, 8000, mock_application, ThreadedWSGIServer, WSGIRequestHandler,
    ) as server:
        server.serve_forever()
