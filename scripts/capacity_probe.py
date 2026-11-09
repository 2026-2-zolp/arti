# 1/2GiB 후보의 격리 웹·API·PG 혼합 부하와 메모리/OOM·중복 저장을 측정합니다.
"""python scripts/capacity_probe.py --output <new-directory>; no cloud or real artwork/key use."""
import argparse
import concurrent.futures
import json
import math
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
SEED='''
import hashlib,json
from datetime import timedelta
from django.utils import timezone
from arti.models import Account,Session,Artwork,Visit,VisitReaction
assert not Artwork.objects.exclude(id__startswith='fixture-').exists()
a=Account.objects.create(login_id='capacity-user',nickname='합성 사용자',role='user',password='!')
Session.objects.create(account=a,token_hash=hashlib.sha256(b'capacity-synthetic-token').hexdigest(),expires_at=timezone.now()+timedelta(days=1))
print(json.dumps({'artworks':Artwork.objects.count(),'visits':Visit.objects.count(),'reactions':VisitReaction.objects.count()}))
'''


def command(args, *, env=None, text=None):
    r=subprocess.run(args,cwd=ROOT,env=env,input=text,text=True,encoding='utf-8',errors='replace',capture_output=True)
    if r.returncode: raise RuntimeError(r.stdout[-2000:]+r.stderr[-2000:])
    return r.stdout.strip()


def request(base,path,body=None,auth=False):
    headers={'Content-Type':'application/json'}
    if auth: headers['Authorization']='Bearer capacity-synthetic-token'
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    start=time.monotonic()
    try:
        with urllib.request.urlopen(req,timeout=10) as r: status=r.status; raw=r.read()
    except urllib.error.HTTPError as e: status=e.code; raw=e.read()
    try: value=json.loads(raw)
    except (ValueError,UnboundLocalError): value=None
    return {'status':status,'ms':round((time.monotonic()-start)*1000,2),'value':value}


def summarize(rows):
    times=sorted(r['ms'] for r in rows)
    return {'requests':len(rows),'statuses':{str(s):sum(r['status']==s for r in rows) for s in sorted(set(r['status'] for r in rows))},
            'p50Ms':times[math.ceil(len(times)*.5)-1],'p95Ms':times[math.ceil(len(times)*.95)-1],'maxMs':max(times)}


def run_case(mib,output):
    # 제한 합계 외에 OS/Docker용 여유를 남깁니다. 호스트 전체 RAM을 제한한 시험은 아닙니다.
    api,db=(384,192) if mib==1024 else (768,384)
    env=os.environ|{'CAP_API_MB':str(api),'CAP_DB_MB':str(db),'CAP_PORT':'5204'}
    project='arti-capacity-'+str(mib)+'-'+str(int(time.time()))
    prefix=['docker','compose','-f','compose.capacity.yaml','-p',project]
    def compose(*args,text=None): return command(prefix+list(args),env=env,text=text)
    assert not compose('ps','-aq'), 'Refusing to reuse a running/previous capacity project'
    base='http://127.0.0.1:5204'; samples=[]; stop=threading.Event(); thread=None
    try:
        compose('up','-d','db')
        compose('run','--rm','api','python','manage.py','migrate','--noinput')
        compose('run','--rm','api','python','manage.py','load_test_fixture')
        before=compose('run','--rm','-T','api','python','manage.py','shell','-c',SEED)
        compose('up','-d','api','web')
        for _ in range(60):
            try:
                if request(base,'/api/ready')['status']==200: break
            except (OSError,TimeoutError): pass
            time.sleep(.5)
        else: raise RuntimeError('API readiness failed')
        ids={service:compose('ps','-q',service) for service in ['api','db','web']}
        def sample():
            while not stop.is_set():
                try:
                    row={}
                    for service,cid in ids.items():
                        values=command(['docker','exec',cid,'sh','-c',
                            'if [ -f /sys/fs/cgroup/memory.current ]; then echo v2; cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events /sys/fs/cgroup/cpu.stat; else echo v1; cat /sys/fs/cgroup/memory/memory.usage_in_bytes /sys/fs/cgroup/memory/memory.max_usage_in_bytes; echo failcnt $(cat /sys/fs/cgroup/memory/memory.failcnt); cat /sys/fs/cgroup/memory/memory.oom_control /sys/fs/cgroup/cpu/cpu.stat; fi'])
                        lines=values.splitlines()
                        row[service]={'version':lines[0],'currentBytes':int(lines[1]),'peakBytes':int(lines[2]),
                                      **{k:int(v) for k,v in (line.split() for line in lines[3:])}}
                    samples.append(row)
                except RuntimeError as e: samples.append({'samplingError':str(e)})
                stop.wait(1)
        thread=threading.Thread(target=sample,daemon=True);thread.start()
        index=request(base,'/')
        deep=request(base,'/exhibitions/fixture-ex01')
        ready=request(base,'/api/ready')
        result={'candidateMiB':mib,'limitsMiB':{'api':api,'db':db,'web':64},'unallocatedMiB':mib-api-db-64,'before':before,
                'httpSmoke':{'index':index['status'],'deepLink':deep['status'],'ready':ready['status']},'loads':[]}
        rec={'exhibitionId':'fixture-ex01','duration':'30m','tastes':['landscape','warm']}
        paths=['/','/api/exhibitions','/api/artworks?exhibitionId=fixture-ex01','/api/artworks/fixture-art01','/api/recommendations']
        for concurrency,count in [(5,100),(20,400),(50,1000)]:
            def read(i):
                path=paths[i%len(paths)]
                row=request(base,path,rec if path.endswith('recommendations') else None)
                assert row['status']==200,(path,row)
                return row
            start=time.monotonic()
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool: rows=list(pool.map(read,range(count)))
            result['loads'].append({'concurrency':concurrency,'seconds':round(time.monotonic()-start,3),**summarize(rows)})
        # 동일 visitId를 두 번 보내도 PG에는 한 번만 저장되어야 합니다.
        def write(_):
            payload=dict(visitId=str(uuid.uuid4()),exhibitionId='fixture-ex01',date='2026-11-09T01:00:00Z',durationMin=10,recommendedCount=3,
                         selectedDuration='30m',requestGeneration=1,tastes=['landscape','warm'],viewedArtworkIds=['fixture-art01'],
                         reactions={'fixture-art01':'like'},reactionReasons={'fixture-art01':'합성 부하 시험'},dwell={'fixture-art01':21})
            a=request(base,'/api/visits',payload,True);b=request(base,'/api/visits',payload,True)
            assert a['status'] in (200,201) and b['status']==200,(a,b)
            return [a,b]
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool: pairs=list(pool.map(write,range(100)))
        result['writes']=summarize([r for pair in pairs for r in pair])
        # 짧은 burst 외에 반복 조회를 60초 유지합니다. AWS 장시간 soak를 대신하지 않습니다.
        until=time.monotonic()+60
        def soak(_):
            rows=[]
            while time.monotonic()<until:
                row=request(base,'/api/artworks?exhibitionId=fixture-ex01')
                assert row['status']==200,row
                rows.append(row)
            return rows
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool: batches=list(pool.map(soak,range(20)))
        result['soak']=summarize([row for batch in batches for row in batch])
        after=compose('exec','-T','api','python','manage.py','shell','-c',"import json;from arti.models import Visit,VisitReaction;print(json.dumps({'visits':Visit.objects.count(),'reactions':VisitReaction.objects.count()}))")
        result['after']=after
        counts=json.loads(after.splitlines()[-1]);assert counts=={'visits':100,'reactions':100},counts
        # 재시작 후 DB·파일의 지속성을 확인합니다.
        compose('restart','api','db')
        for _ in range(60):
            try:
                if request(base,'/api/ready')['status']==200: break
            except OSError: pass
            time.sleep(.5)
        else: raise RuntimeError('Restart recovery failed')
        persisted=compose('exec','-T','api','python','manage.py','shell','-c',"from arti.models import Visit;from django.conf import settings;assert Visit.objects.count()==100;assert (settings.MEDIA_ROOT/'fixture-public.png').is_file();print('100 visits and media preserved')")
        result['restart']=persisted
        stop.set();thread.join(10)
        result['resources']=samples
        result['containers']=json.loads(command(['docker','inspect',*ids.values()]))
        # 기록에는 환경/호스트 경로/인증값을 포함하지 않습니다.
        result['containers']=[{'name':x['Name'],'oomKilled':x['State']['OOMKilled'],'restartCount':x['RestartCount'],
                               'memoryLimit':x['HostConfig']['Memory'],'swapLimit':x['HostConfig']['MemorySwap'],
                               'nanoCpus':x['HostConfig']['NanoCpus']} for x in result['containers']]
        valid_samples=[s for s in samples if all(k in s for k in ids)]
        result['memoryPeakMiB']={k:round(max(s[k]['peakBytes'] for s in valid_samples)/1048576,2) for k in ids} if valid_samples else {}
        result['passed']=bool(valid_samples) and not any('samplingError' in s for s in samples) and all(x['p95Ms']<2000 for x in result['loads']+[result['soak']]) and result['writes']['p95Ms']<2000 and not any(x['oomKilled'] for x in result['containers']) and all(s[k].get('oom_kill',0)==0 and s[k].get('failcnt',0)==0 for s in valid_samples for k in ids)
        (output/f'{mib}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({k:v for k,v in result.items() if k not in ('resources','containers')},ensure_ascii=True),flush=True)
        assert result['passed'],'Capacity criteria failed'
    finally:
        stop.set()
        if thread: thread.join(10)
        # 새로 생성한 이 전용 프로젝트만 중지합니다. 시험 볼륨은 증거 보존합니다.
        compose('down')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    env=os.environ|{'CAP_API_MB':'384','CAP_DB_MB':'192','CAP_PORT':'5204'}
    build=command(['docker','compose','-f','compose.capacity.yaml','-p','arti-capacity-build','build','api','web'],env=env)
    (args.output/'build.txt').write_text(build,encoding='utf-8')
    for size in (1024,2048): run_case(size,args.output)
