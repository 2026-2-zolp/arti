# 격리 Gunicorn·Nginx 경로에서 60초 전체 분석 예산과 연결 중단 후 재시도 보호를 확인합니다.
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error
from capacity_probe import command, request, summarize, ROOT

PROVIDER='''
import json,time,threading
import sys
sys.path.insert(0,'/app')
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from arti.constants import TAGS,EMOTIONS
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        kind='model' if self.path=='/analyze' else ('guide' if 'JSON {"intro"' in data['messages'][0]['content'] else 'summary')
        with open('/tmp/budget-events','a') as log:log.write(kind+'\\n')
        delay=float(Path('/tmp/budget-delay').read_text());time.sleep(delay)
        if kind=='model':value=dict(tags={k:.5 for k in TAGS},emotions={k:.5 for k in EMOTIONS},usedImage=True,usedText=True,tagSource='image',imageError=None,models={'image':'synthetic','text':'synthetic'})
        else:
            content={'intro':'합성 도입','questions':['관찰 질문'],'hints':['관찰 힌트']} if kind=='guide' else {'summary':'합성 요약','keywords':['관찰']}
            value={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(content)}}]}
        try:
            self.send_response(200);self.end_headers();self.wfile.write(json.dumps(value).encode())
        except (BrokenPipeError,ConnectionResetError):pass
Path('/tmp/budget-delay').write_text('.1')
ThreadingHTTPServer(('127.0.0.1',18091),Handler).serve_forever()
'''
SEED='''
import hashlib
from datetime import timedelta
from django.utils import timezone
from arti.models import Account,Session,Artwork
assert not Artwork.objects.exclude(id__startswith='fixture-').exists()
a=Account.objects.create(login_id='budget-admin',nickname='합성 관리자',role='admin',password='!')
Session.objects.create(account=a,token_hash=hashlib.sha256(b'budget-synthetic-token').hexdigest(),expires_at=timezone.now()+timedelta(days=1))
Artwork.objects.filter(pk='fixture-art01').update(summary_status='suggested',guide_status='suggested',tag_status='suggested',emotion_status='suggested')
'''


def main():
    out=ROOT/'docs/execution-plan/2026-11-07/records/W12/capacity-2026-11-09/request-budget.json'
    assert not out.exists()
    env=os.environ|{'CAP_API_MB':'384','CAP_DB_MB':'192','CAP_PORT':'5205','CAP_LLM_PROVIDER':'openai_compatible','CAP_LLM_KEY':'synthetic-not-paid','CAP_MODEL_URL':'http://127.0.0.1:18091'}
    prefix=['docker','compose','-f','compose.capacity.yaml','-p','arti-budget-'+str(int(time.time()))]
    def compose(*args,text=None):return command(prefix+list(args),env=env,text=text)
    def shell(code):return compose('exec','-T','api','python','manage.py','shell','-c',code)
    def snapshot():
        code="import json;from arti.models import Artwork;w=Artwork.objects.get(pk='fixture-art01');print(json.dumps({'version':w.version,'summary':w.summary,'summaryStatus':w.summary_status,'guideIntro':w.guide_intro,'guideStatus':w.guide_status,'tagScores':w.tag_scores,'analysis':w.analysis,'artworks':Artwork.objects.count()}))"
        return json.loads(shell(code).splitlines()[-1])
    def delay(seconds):compose('exec','-T','api','python','-c',f"from pathlib import Path;Path('/tmp/budget-delay').write_text('{seconds}')")
    def events():return compose('exec','-T','api','cat','/tmp/budget-events').splitlines()
    base='http://127.0.0.1:5205';path='/api/admin/artworks/fixture-art01/analyze'
    def analyze(version,timeout=80):
        start=time.monotonic()
        req=urllib.request.Request(base+path,data=json.dumps({'version':version}).encode(),headers={'Content-Type':'application/json','X-Admin-Token':'budget-synthetic-token'})
        try:
            with urllib.request.urlopen(req,timeout=timeout) as r:status=r.status;value=json.load(r)
        except urllib.error.HTTPError as e:status=e.code;value=json.load(e)
        return {'status':status,'seconds':round(time.monotonic()-start,3),'value':value}
    assert not compose('ps','-aq')
    result={}
    try:
        compose('up','-d','db')
        compose('run','--rm','api','python','manage.py','migrate','--noinput')
        compose('run','--rm','api','python','manage.py','load_test_fixture')
        compose('up','-d','api','web')
        for _ in range(60):
            try:
                if request(base,'/api/ready')['status']==200:break
            except OSError:pass
            time.sleep(.5)
        else:raise RuntimeError('API readiness failed')
        shell(SEED)
        compose('exec','-T','api','python','-c',"from pathlib import Path;Path('/tmp/budget-provider.py').write_text("+repr(PROVIDER)+")")
        compose('exec','-d','api','python','/tmp/budget-provider.py')
        time.sleep(.5)
        compose('exec','-T','api','python','-c',"import socket;socket.create_connection(('127.0.0.1',18091),3).close()")
        before=snapshot();delay(21)
        # 21+21+남은18초: 모델 호출을 줄여 전체 60초를 지키고 부분 저장을 막습니다.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(analyze,before['version'])
            time.sleep(1)
            start=time.monotonic()
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as readers:
                rows=list(readers.map(lambda _:request(base,'/api/artworks?exhibitionId=fixture-ex01'),range(100)))
            result['readsWhileAnalysis']={**summarize(rows),'seconds':round(time.monotonic()-start,3)}
            timed=future.result()
        after=snapshot()
        result['timeout']={'status':timed['status'],'seconds':timed['seconds'],'code':timed['value'].get('code'),'unchanged':before==after,'providerCalls':events()}
        assert timed['status']==504 and 59<=timed['seconds']<66 and before==after,result['timeout']
        assert result['readsWhileAnalysis']['statuses']=={'200':100} and result['readsWhileAnalysis']['p95Ms']<2000
        delay(.1);recovered=analyze(before['version']);current=snapshot()
        result['recovery']={'status':recovered['status'],'seconds':recovered['seconds'],'oneVersionIncrement':current['version']==before['version']+1}
        assert recovered['status']==200 and result['recovery']['oneVersionIncrement']
        # HTTP 연결 중단은 서버 취소가 아닙니다. 늦게 한 번 저장된 후 기존 version 재전송은 409여야 합니다.
        delay(1);old=current['version']
        try:analyze(old,timeout=.2);raise AssertionError('Expected client timeout')
        except TimeoutError:pass
        time.sleep(4)
        late=snapshot();calls_before=len(events());retry=analyze(old);calls_after=len(events())
        result['disconnect']={'oneVersionIncrement':late['version']==old+1,'retryStatus':retry['status'],'retryExtraProviderCalls':calls_after-calls_before,'artworks':late['artworks']}
        assert result['disconnect']['oneVersionIncrement'] and retry['status']==409 and calls_before==calls_after
        result['passed']=True
        out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(result,ensure_ascii=True),flush=True)
    finally:compose('down')


if __name__=='__main__':main()
