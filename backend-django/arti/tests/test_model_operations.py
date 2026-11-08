# 실제 HTTP 장애와 지연을 PostgreSQL/API에 연결해 저장·버전·재시도 보호를 확인합니다.
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from django.test import TransactionTestCase, override_settings
from django.db import close_old_connections
from arti.models import Artwork
from arti.tests.test_integration import Helpers
from arti.tests.test_model_service import result


@contextmanager
def service():
    state={'status':200,'delay':False,'calls':0,'beforeReply':None}
    entered=threading.Event();release=threading.Event();completed=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']));state['calls']+=1;entered.set()
            if state['delay']:release.wait(2)
            try:
                if state['beforeReply']:
                    close_old_connections()
                    try:state['beforeReply']()
                    finally:close_old_connections()
                value=result();value.update(usedImage=False,tagSource='text')
                self.send_response(state['status']);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(json.dumps(value).encode())
            except (BrokenPipeError,ConnectionResetError):pass
            finally:completed.set()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with override_settings(ARTI_MODEL_SERVICE_URL=f'http://127.0.0.1:{server.server_port}'):
            yield state,entered,release,completed
    finally:
        release.set();server.shutdown();server.server_close();thread.join(2)


@override_settings(ARTI_ENV='test',ALLOW_TEST_FIXTURES=True,ARTI_LLM_PROVIDER='disabled')
class ModelOperationTests(Helpers,TransactionTestCase):
    def setUp(self):
        self.setup_clients();self.work=Artwork.objects.get(pk='fixture-art01')
        self.work.image_url='';self.work.image_file=None
        self.work.tag_scores={'landscape':.2};self.work.tag_status='suggested'
        self.work.analysis={'emotions':{'calm':.2}};self.work.emotion_status='suggested'
        self.work.save()

    def snapshot(self):
        self.work.refresh_from_db()
        return (self.work.version,self.work.tag_scores,self.work.analysis,self.work.tag_status,self.work.emotion_status)

    def call(self):
        return self.admin.post('/api/admin/artworks/fixture-art01/analyze',{'version':self.work.version},format='json')

    def test_busy_unavailable_and_recovery_without_duplicate_calls(self):
        before=self.snapshot()
        with service() as (state,*_):
            for status in [429,503]:
                state.update(status=status,calls=0)
                response=self.call()
                self.assertEqual(response.status_code,status,response.content)
                if status==429:self.assertEqual(response['Retry-After'],'1')
                self.assertEqual(state['calls'],1)
                self.assertEqual(self.snapshot(),before)
            state.update(status=200,calls=0)
            response=self.call();self.assertEqual(response.status_code,200,response.content)
            self.assertEqual(state['calls'],1)
            self.work.refresh_from_db()
            from django.utils.dateparse import parse_datetime
            self.assertIsNotNone(parse_datetime(self.work.analysis['analyzedAt']))
            self.assertEqual(self.work.tag_status,'suggested');self.assertEqual(self.work.emotion_status,'suggested')
            self.assertEqual(self.work.review_status,'approved')

    def test_timeout_late_reply_cannot_write_and_next_request_recovers(self):
        before=self.snapshot()
        with service() as (state,entered,release,completed):
            state['delay']=True
            with patch('arti.model_service.TIMEOUT_SECONDS',.05):response=self.call()
            self.assertEqual(response.status_code,504,response.content)
            self.assertTrue(entered.is_set());self.assertEqual(state['calls'],1)
            self.assertEqual(self.snapshot(),before)
            release.set();self.assertTrue(completed.wait(1))
            self.assertEqual(self.snapshot(),before)
            state.update(delay=False,calls=0)
            self.assertEqual(self.call().status_code,200)
            self.assertEqual(state['calls'],1)

    def test_successful_late_model_result_rejected_after_version_change(self):
        old=self.snapshot()
        with service() as (state,*_):
            state['beforeReply']=lambda:Artwork.objects.filter(pk=self.work.id).update(version=old[0]+1)
            response=self.call()
            self.assertEqual(response.status_code,409,response.content)
            self.assertEqual(state['calls'],1)
        current=self.snapshot()
        self.assertEqual(current[0],old[0]+1)
        self.assertEqual(current[1:],old[1:])
