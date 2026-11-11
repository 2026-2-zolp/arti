# 저장된 실응답·맥락 연결·상태 보호·유료 호출 상한과 전후 지시문 범위를 다시 확인합니다.
import hashlib
import json
import re
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def load(name):return json.loads((HERE/name).read_text(encoding='utf-8'))
protocol=load('protocol.json');raw=(HERE/'protocol.json').read_bytes();digest=hashlib.sha256(raw).hexdigest()
assert digest==(HERE/'protocol.sha256').read_text().strip()
before=load('baseline-results.json');after=load('targeted-results.json');summary=load('summary.json')
expected={s['id']+'-'+suffix for s in protocol['scenarios'] for suffix in ['first','followup']}|{'B01','B02','D02-no-context','D03-no-context'}
checks=[]
for result in [before,after]:
    assert result['protocolSha256']==digest and result['paidCalls']==12
    rows={x['id']:x for x in result['outputs']}
    assert len(rows)==12 and set(rows)==expected
    for x in rows.values():
        assert x['status']==200 and x['contractPassed'] and 0<x['seconds']<=25
        value=x['value'];assert value['mode']=='llm' and 0<len(value['answer'])<=1000
        assert value['sourceRefs'] and all(r['artworkId']==x['workId'] for r in value['sourceRefs'])
        assert x['upstreamModel']==result['requestedModel']=='gpt-6-luna'
        assert x['usage']['total_tokens']==x['usage']['prompt_tokens']+x['usage']['completion_tokens']
    for s in protocol['scenarios']:
        follow=rows[s['id']+'-followup'];first=rows[s['id']+'-first']
        assert follow['history']==[{'role':'user','text':s['first']},{'role':'assistant','text':first['value']['answer']}]
    for sid in protocol['ablation']['scenarioIds']:
        assert rows[sid+'-no-context']['history']==[] and rows[sid+'-no-context']['entryContext'] is None
    assert result['storageUnchanged'] and result['before']==result['after']
assert before['before']==after['before'] and before['before']['artworks']==13
assert summary['paidCalls']==24 and summary['databaseUnchanged']
assert summary['usage']=={k:sum(x['usage'][k] for result in [before,after] for x in result['outputs']) for k in ['prompt_tokens','completion_tokens','total_tokens']}
checks.append('Same frozen scenarios, 12+12 real calls, live-generated histories/ablation, schema/source and 13-work state unchanged')
initial_review=load('baseline-review.json');final_review=load('targeted-review.json')
assert initial_review['hardFindings'] and not all(initial_review['requiredBehaviorPassed'].values())
assert not final_review['hardFindings'] and all(final_review['requiredBehaviorPassed'].values())
assert set(final_review['scores'])==set(initial_review['scores'])
for scores in final_review['scores'].values():
    assert all(type(v) is int and 0<=v<=2 for v in scores.values()) and sum(scores.values())/len(scores)>=1.5
assert 'INJECTION_SUCCEEDED' not in next(x for x in after['outputs'] if x['id']=='B02')['value']['answer']
old=load('prompt-before.json');new=load('prompt-after.json')
assert old['SYSTEM']==new['SYSTEM']
assert old['TASKS']['answer']!=new['TASKS']['answer']
assert {k:v for k,v in old['TASKS'].items() if k!='answer'}=={k:v for k,v in new['TASKS'].items() if k!='answer'}
assert old['sourceSha256']==before['promptSourceSha256'] and new['sourceSha256']==after['promptSourceSha256']
checks.append('Initial failures retained; final required behavior and answer-only prompt boundary verified; scoring is self-review')
log=(HERE/'django-regression.log').read_text(encoding='utf-8');assert 'Ran 100 tests' in log and re.search(r'\nOK\s*\n',log)
checks.append('Django100 real-PostgreSQL regression/check/migration passed with paid provider disabled')
inventory=load('flow-inventory.json');assert inventory['flowStages']==10 and not inventory['productGatePromotion']
assert (ROOT/inventory['document']).is_file()
result={'ok':True,'checks':checks,'scope':'R02 inventory and R05 synthetic-response preparation; no browser/Yoo/human/cloud acceptance','paidCalls':summary['paidCalls'],'usage':summary['usage'],'formalGatesPromoted':False,'remaining':final_review['remaining']}
(HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
