# 전체 예산 소진 시 부분·늦은 결과를 저장하지 않고 다음 요청을 허용하는지 확인합니다.
from unittest.mock import patch
from django.test import TransactionTestCase, override_settings, SimpleTestCase
from arti import budget
from arti.models import Artwork
from arti.tests.test_integration import Helpers
from arti.http import ContractError
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from arti.tests.test_model_service import result


class BudgetTests(SimpleTestCase):
    def test_remaining_caps_socket_timeout_and_rejects_expired(self):
        with patch('arti.budget.monotonic', return_value=100):
            self.assertEqual(budget.remaining(103, 25), 3)
            self.assertEqual(budget.remaining(None, 25), 25)
            with self.assertRaises(ContractError): budget.remaining(100, 25)


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class AnalysisBudgetTests(Helpers, TransactionTestCase):
    def setUp(self):
        self.setup_clients()
        Artwork.objects.filter(pk='fixture-art01').update(summary_status='suggested', guide_status='suggested')

    def test_late_success_rolls_back_all_partial_results_and_releases_slot(self):
        work=Artwork.objects.get(pk='fixture-art01')
        before=(work.version, work.summary, work.guide_intro, work.tag_scores)
        clock=[0]
        def generate(kind, snapshot, **context):
            self.assertEqual(context['deadline'], 60)
            clock[0] += 31
            return {'summary':'합성 새 요약','keywords':[]} if kind=='summary' else {'intro':'합성 도입','questions':[],'hints':[]}
        with patch('arti.budget.monotonic', side_effect=lambda:clock[0]), patch('arti.providers.generate', side_effect=generate) as provider:
            response=self.admin.post('/api/admin/artworks/'+work.id+'/analyze', {'version':work.version}, format='json')
        self.assertEqual(response.status_code, 504, response.content)
        self.assertEqual(provider.call_count, 2)
        work.refresh_from_db()
        self.assertEqual((work.version, work.summary, work.guide_intro, work.tag_scores), before)
        from arti.editing import analysis_slot
        with analysis_slot(): pass

    def test_real_http_text_and_model_share_budget_without_partial_save(self):
        work=Artwork.objects.get(pk='fixture-art01')
        before=(work.version,work.summary,work.guide_intro,work.tag_scores)
        calls=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append(self.path)
                time.sleep(.3)
                if self.path=='/analyze': value=result()
                else:
                    task=body['messages'][0]['content']
                    content={'intro':'합성 도입','questions':[],'hints':[]} if 'JSON {"intro"' in task else {'summary':'합성 요약','keywords':[]}
                    value={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(content)}}]}
                try:
                    self.send_response(200);self.end_headers();self.wfile.write(json.dumps(value).encode())
                except (BrokenPipeError,ConnectionResetError): pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with override_settings(ARTI_LLM_PROVIDER='openai_compatible',OPENAI_BASE_URL=base+'/v1',OPENAI_API_KEY='synthetic',OPENAI_MODEL='synthetic',ARTI_LLM_MODELS={},ARTI_MODEL_SERVICE_URL=base), patch('arti.budget.ANALYSIS_SECONDS',.8):
                start=time.monotonic()
                response=self.admin.post('/api/admin/artworks/'+work.id+'/analyze',{'version':work.version},format='json')
                elapsed=time.monotonic()-start
            self.assertEqual(response.status_code,504,response.content)
            self.assertEqual(calls,['/v1/chat/completions','/v1/chat/completions','/analyze'])
            self.assertLess(elapsed,1.5)
            work.refresh_from_db()
            self.assertEqual((work.version,work.summary,work.guide_intro,work.tag_scores),before)
        finally:
            server.shutdown();server.server_close();thread.join(2)
