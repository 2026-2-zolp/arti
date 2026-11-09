# 원시 측정의 누락·성능·저장 보호와 비용 계산을 다시 검사합니다.
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

HERE=Path(__file__).resolve().parent
checks=[]
def load(path): return json.loads((HERE/path).read_text(encoding='utf-8'))
for size in [1024,2048]:
    first=load(f'{size}.json');assert not first['passed'] and first['supersededReason']
    d=load(f'recheck/{size}.json')
    assert d['passed'] and sum(d['limitsMiB'].values())+d['unallocatedMiB']==size
    assert d['httpSmoke']=={'index':200,'deepLink':200,'ready':200}
    assert len(d['resources'])>30 and not any('samplingError' in s for s in d['resources'])
    for s in d['resources']:
        for service in ['api','db','web']:
            assert s[service]['peakBytes']>0
            assert s[service].get('failcnt',0)==0 and s[service].get('oom_kill',0)==0
    for r in d['loads']+[d['soak']]:assert r['p95Ms']<2000 and r['statuses']=={'200':r['requests']}
    assert d['writes']['statuses']=={'200':100,'201':100} and d['writes']['p95Ms']<2000
    assert json.loads(d['after'].splitlines()[-1])=={'visits':100,'reactions':100}
    for c in d['containers']:assert not c['oomKilled'] and c['restartCount']==0 and c['memoryLimit']==c['swapLimit']
    checks.append(f'{size}MiB limited-container capacity passed, not full VM/cloud acceptance')
r=load('request-budget.json')
assert r['passed'] and r['timeout']['status']==504 and 59<=r['timeout']['seconds']<66 and r['timeout']['unchanged']
assert r['timeout']['providerCalls']==['summary','guide','model']
assert r['recovery']['status']==200 and r['recovery']['oneVersionIncrement']
assert r['disconnect']['oneVersionIncrement'] and r['disconnect']['retryStatus']==409 and r['disconnect']['retryExtraProviderCalls']==0
assert r['readsWhileAnalysis']['statuses']=={'200':100} and r['readsWhileAnalysis']['p95Ms']<2000
assert load('static-assets.json')['passed']
assert all(v['exitCode']==0 for v in load('regression/linux-results.json')['results'].values())
checks+=['Real Nginx/Gunicorn/PG 60s delayed-header budget and disconnect/version protection','Linux regression commands passed; not remote CI']
rate=Decimal(load('ec2-micro-price.json')['selected']['PricePerUnit'])
assert rate==Decimal('.013')
money=lambda v:str(v.quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
fixed=Decimal('20')*Decimal('.0912')+Decimal('720')*Decimal('.005')+Decimal('5')*Decimal('.025')
cost={'ec2Micro720':money(rate*720+fixed),'ec2Small720':money(Decimal('.026')*720+fixed),
      'ec2Micro176':money(rate*176+fixed),'ec2Small176':money(Decimal('.026')*176+fixed),
      'lightsail1GB':money(Decimal('7')+Decimal('.125')),'lightsail2GB':money(Decimal('12')+Decimal('.125'))}
assert cost=={'ec2Micro720':'14.91','ec2Small720':'24.27','ec2Micro176':'7.84','ec2Small176':'10.13','lightsail1GB':'7.13','lightsail2GB':'12.13'}
checks.append('Cost subtotal arithmetic, exclusions remain required')
review={
 'senior':'Shared budget/late writes/slot/version covered. Whole infrastructure hard deadline remains open.',
 'operations':'cgroup v1 metrics complete; OS/credits/backup/cloud not accepted; original data untouched.',
 'visitor':'Reads during one slow analysis passed. Two AI-occupied sync workers remain unverified.',
 'teamProfessorExternalEvaluator':'Small-EC2 precedent compared with SQLite/external APIs; no claim of monthly bill or actual human approval.'}
result={'ok':True,'scope':'Local preparation only; no cloud/content/remote CI gates advanced','checks':checks,'costSubtotalsUsd':cost,'selfReviewPersonas':review,'next':'Production settings/proxy contract and DB TLS local preparation'}
(HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
