"""Serve the product API with a loopback-only docent provider for browser tests."""

import json
from time import sleep
from unittest.mock import patch
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from arti.tests.test_provider import endpoint


def serve():
    if settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES:
        raise RuntimeError('Use an isolated ARTI test database with synthetic fixtures.')

    pending = {}
    faults = {'502': 500, '429': 429, '504': 200}

    def respond(attempt):
        wire = requests[attempt - 1]
        prompt = json.loads(wire['body']['messages'][1]['content'])
        question = prompt.get('question') or ''
        parts = question.split(' ', 3)
        fault = parts[1] if len(parts) == 4 and parts[0] == '[합성' else ''
        if fault in faults:
            previous = pending.pop(question, None)
            if previous is None:
                pending[question] = wire['raw']
                if fault == '504':
                    sleep(1.5)  # The real HTTP read exceeds the shortened adapter timeout.
                else:
                    return faults[fault], b'upstream-private-debug'
            elif previous != wire['raw']:
                return 400, b'the provider retry did not preserve the original prompt'

        answer = {
            'answer': '합성 답변입니다. 밝은 부분을 살펴보세요. <img src=x>',
            'sourceRefs': [{'artworkId': 'forged-work', 'kind': 'summary'}],
        }
        response = {'choices': [{
            'finish_reason': 'stop', 'message': {'content': json.dumps(answer, ensure_ascii=False)},
        }]}
        return 200, json.dumps(response, ensure_ascii=False).encode()

    application = get_wsgi_application()

    def mock_application(environ, start_response):
        def mark(status, headers, exc_info=None):
            return start_response(status, [*headers, ('X-Arti-Docent-Mock', '1')], exc_info)

        return application(environ, mark)

    with override_settings(
        ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-browser-only',
        OPENAI_MODEL='synthetic-browser-only', ARTI_LLM_MODELS={}, ARTI_MODEL_SERVICE_URL='',
    ), endpoint(respond=respond) as requests, patch('arti.llm.TIMEOUT_SECONDS', 1), make_server(
        '0.0.0.0', 8000, mock_application,
    ) as server:
        server.serve_forever()
