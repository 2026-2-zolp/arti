# 외부 모델 adapter의 요청·오류·보안 경계를 가상 응답으로 검증합니다.
"""Provider transport/contracts without paid keys or external HTTP."""
import io
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError, URLError
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from arti import providers
from arti.http import ContractError
from arti.llm import MAX_RESPONSE_BYTES


@contextmanager
def endpoint(status=200, body=None):
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            requests.append({'path': self.path, 'authorization': self.headers.get('Authorization'),
                             'body': json.loads(self.rfile.read(int(self.headers['Content-Length'])))})
            self.send_response(status)
            if status == 302: self.send_header('Location', '/credential-must-not-arrive')
            self.end_headers()
            self.wfile.write(body if body is not None else json.dumps({'choices': [{
                'finish_reason': 'stop', 'message': {'content': '{"answer":"관찰을 이어 볼까요?"}'}}]}, ensure_ascii=False).encode())
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        with override_settings(OPENAI_BASE_URL=f'http://127.0.0.1:{server.server_port}/v1'):
            yield requests
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)


@override_settings(ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-provider-test-key',
                   OPENAI_MODEL='test-model', ARTI_LLM_MODELS={}, ARTI_LLM_JSON_MODE=True,
                   ARTI_LLM_TOKEN_PARAMETER='max_completion_tokens')
class ProviderTests(SimpleTestCase):
    def failure(self, status, call):
        with self.assertRaises(ContractError) as cm: call()
        self.assertEqual(cm.exception.status_code, status)
        self.assertNotIn('synthetic-provider-test-key', str(cm.exception))

    def test_actual_http_wire_context_and_data_minimization(self):
        with endpoint() as requests:
            result = providers.generate('answer', {'id': 'work', 'description': '근거 원문', 'password': 'never-forward', 'analysis': {'internal': 'not-for-llm'},
                                        'summary':'unreviewed-summary-sentinel', 'summaryStatus':'suggested',
                                        'guideIntro':'unreviewed-guide-sentinel','guideStatus':'none','guidedLooking':['unreviewed-question-sentinel']},
                                        entry={'kind': 'guide', 'question': '어떤 색인가요?'},
                                        history=[{'role': 'user', 'text': '파랑 같아요'}, {'role': 'assistant', 'text': '어디서 보았나요?'}], question='더 알려줘요')
        self.assertEqual(result['answer'], '관찰을 이어 볼까요?')
        self.assertEqual(len(requests), 1)
        wire = requests[0]
        self.assertEqual(wire['path'], '/v1/chat/completions')
        self.assertEqual(wire['authorization'], 'Bearer synthetic-provider-test-key')
        self.assertEqual(wire['body']['model'], 'test-model')
        self.assertEqual(wire['body']['max_completion_tokens'], 2000)
        prompt=json.loads(wire['body']['messages'][1]['content'])
        self.assertEqual(prompt['entry']['question'], '어떤 색인가요?')
        self.assertEqual(len(prompt['history']), 2)
        self.assertNotIn('password', prompt['artworkData']); self.assertNotIn('analysis', prompt['artworkData'])
        self.assertNotIn('unreviewed-', json.dumps(wire['body']))

    @override_settings(ARTI_LLM_MODELS={'answer': 'other-model'}, ARTI_LLM_JSON_MODE=False, ARTI_LLM_TOKEN_PARAMETER='max_tokens')
    def test_compatible_options_and_task_model(self):
        with endpoint() as requests: providers.generate('answer', {})
        self.assertEqual(requests[0]['body']['model'], 'other-model')
        self.assertIn('max_tokens', requests[0]['body']); self.assertNotIn('response_format', requests[0]['body'])

    def test_all_text_tasks_validate_structured_outputs(self):
        results={'summary':{'summary':'원문 요약','keywords':['색']}, 'guide':{'intro':'살펴봐요','questions':['어떤 색인가요?'],'hints':['중앙을 보세요']},
                 'explanation':{'text':'쉬운 설명'}, 'interpret':{'text':'관람 기록 해석'}}
        for kind, value in results.items():
            with self.subTest(kind=kind):
                raw=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(value)}}]}).encode()
                with endpoint(body=raw): self.assertEqual(providers.generate(kind, {}),value)

    def test_disabled_missing_key_and_model_do_not_send(self):
        with patch('arti.llm.build_opener') as send:
            for setting in [{'ARTI_LLM_PROVIDER':'disabled'},{'OPENAI_API_KEY':''},{'OPENAI_MODEL':''}]:
                with override_settings(**setting): self.failure(503,lambda:providers.generate('answer',{}))
            send.assert_not_called()

    def test_classifier_is_not_replaced_by_text_llm(self):
        with patch('arti.llm.build_opener') as send:
            for kind in ['tag','emotion']: self.failure(503,lambda:providers.generate(kind,{}))
            send.assert_not_called()

    def test_unsafe_or_malformed_configuration_does_not_send(self):
        with patch('arti.llm.build_opener') as send:
            for base in ['http://outside.example/v1','https://user:pass@example.test/v1','https://example.test/v1?secret=x','https://example.test/v1#x','https://[bad']:
                with override_settings(OPENAI_BASE_URL=base): self.failure(503,lambda:providers.generate('answer',{}))
            with override_settings(ARTI_LLM_TOKEN_PARAMETER='bad'): self.failure(503,lambda:providers.generate('answer',{}))
            send.assert_not_called()

    def test_redirect_is_not_followed(self):
        with endpoint(status=302) as requests: self.failure(502,lambda:providers.generate('answer',{}))
        self.assertEqual(len(requests),1)

    def test_upstream_errors_are_sanitized_without_fallback(self):
        for status, expected in [(401,503),(403,503),(429,429),(500,502)]:
            with self.subTest(status=status), endpoint(status=status,body=b'upstream-private-debug') as requests:
                self.failure(expected,lambda:providers.generate('answer',{})); self.assertEqual(len(requests),1)

    def test_timeout_and_network_failure(self):
        for error, status in [(TimeoutError(),504),(URLError(TimeoutError()),504),(URLError('connection refused'),502)]:
            with self.subTest(status=status), patch('arti.llm.build_opener') as opener:
                opener.return_value.open.side_effect=error
                self.failure(status,lambda:providers.generate('answer',{}))
                self.assertEqual(opener.return_value.open.call_count,1)

    def test_malformed_refusal_truncated_and_oversized_responses(self):
        invalid=[b'not json',b'{}',b'{"choices":null}',b'{"choices":[null]}',
                 b'{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}',
                 b'{"choices":[{"finish_reason":"stop","message":{"refusal":"no","content":"{}"}}]}',
                 b'{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}',b'x'*(MAX_RESPONSE_BYTES+1)]
        for raw in invalid:
            with endpoint(body=raw): self.failure(502,lambda:providers.generate('answer',{}))

    def test_oversized_prompt_does_not_send(self):
        with patch('arti.llm.build_opener') as send:
            self.failure(400,lambda:providers.generate('answer',{'description':'x'*70000}))
            send.assert_not_called()
