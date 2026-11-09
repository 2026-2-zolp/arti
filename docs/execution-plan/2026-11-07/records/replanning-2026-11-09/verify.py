# 재계획의 출처·기존 W/AC 대응·선행 순환·상태 보존을 확인합니다.
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def load(path): return json.loads(path.read_text(encoding='utf-8'))
plan=load(HERE/'plan.json');main=load(ROOT/'execution.json');before=load(HERE/'before-state.json');sources=load(HERE/'sources.json')
checks=[]
for key in ['tasks','gates','criteria']:
    after=[{'id':x['id'],'status':x['status'],**({'criterion':x['criterion']} if key=='criteria' else {})} for x in main[key]]
    assert after==before[key],f'Formal state/criteria changed: {key}'
checks.append('W/G/AC states and criterion text preserved')
ws={x['id'] for x in main['tasks']};acs={x['id']:x for x in main['criteria']}
requirements={x['id']:x for x in plan['requirements']};tasks={x['id']:x for x in plan['tasks']}
assert len(requirements)==10 and len(tasks)==10
covered=set()
for t in tasks.values():
    assert t['status'] in ('planned','in_progress','complete','blocked') and t['owner'] and t['acceptance']
    # 실행 묶음의 진척은 근거가 있어야 하며 공식 W/G/AC 상태를 바꾸지 않습니다.
    if t['status']!='planned':
        assert t.get('progressEvidence') and all((ROOT/p).is_file() for p in t['progressEvidence'])
    assert set(t['works'])<=ws
    assert t['criteria'] and all(k in acs and acs[k]['work'] in t['works'] for k in t['criteria'])
    assert t['requirements'] and set(t['requirements'])<=requirements.keys()
    covered.update(t['requirements'])
    assert set(t['startAfter'])<=tasks.keys()
assert covered==requirements.keys()
def walk(key,stack):
    assert key not in stack,'Overlay prerequisite cycle'
    for dep in tasks[key]['startAfter']:walk(dep,stack+[key])
for key in tasks:walk(key,[])
checks.append('10 requirements covered by 10 execution bundles; W/AC mappings and DAG valid')
assert not tasks['R08']['required'] and 'R08' not in tasks['R10']['startAfter']
assert tasks['R01']['startAfter']==[] and tasks['R09']['startAfter']==[]
assert plan['dialoguePolicy']['explicitDepthSelector'].startswith('optional')
assert not plan['dialoguePolicy']['fixedExpertiseClassification']
assert plan['controls']['formalGatesUnchanged'] and plan['controls']['keepFixedEightTags']
assert not plan['controls']['additionalExhibitionMandatory']
assert plan['schedule']['optionalAdoptionReview']['level']=='author recommendation'
assert plan['schedule']['freeze']['level']=='author recommendation'
checks.append('Progress report/parallel drafts unblocked; optional exhibit/selector and dates not promoted to requirements')
assert len(sources['sources'])==3 and all(x['url'].startswith('https://app.notion.com/p/') and x['lastEdited'] for x in sources['sources'])
ci=sources['remotePushCI'];assert ci['head']==plan['sourceHead'] and ci['event']=='push' and ci['conclusion']=='success'
assert main['consultationReplanning']['executionOverlay']=='records/replanning-2026-11-09/plan.json'
for value in [main['consultationReplanning']['record'],main['consultationReplanning']['executionOverlay'],main['consultationReplanning']['sourceRecord']]:assert (ROOT/value).is_file()
checks.append('Notion source metadata and actual push CI linked; no PR/cloud/human acceptance implied')
result={'ok':True,'checks':checks,'scope':'Plan readiness only, no implementation or product/human/cloud gate promotion','sourceHead':plan['sourceHead'],'next':plan['next']}
(HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
