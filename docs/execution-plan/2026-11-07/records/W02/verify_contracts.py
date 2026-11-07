"""Document examples and pinned source traceability; NOT product acceptance."""
import hashlib, json, re, subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PLAN=ROOT.parents[1]
REPO=ROOT.parents[4]
plan=json.loads((PLAN/'execution.json').read_text(encoding='utf-8'))
inventory=json.loads((ROOT/'source-inventory.json').read_text(encoding='utf-8'))
cases=json.loads((ROOT/'cases.json').read_text(encoding='utf-8'))['cases']
wire=json.loads((ROOT/'wire-examples.json').read_text(encoding='utf-8'))['examples']
errors=[]
ids=set()
for case in cases:
    if case['id'] in ids: errors.append('Duplicate '+case['id'])
    ids.add(case['id'])
    if not case['input'] or not case['expected']: errors.append('Empty '+case['id'])
    for ac in case['criteria']:
        if ac not in {a['id'] for a in plan['criteria']}: errors.append('Unknown '+ac)
for source in inventory['sources']:
    # W04 onward intentionally changes the worktree. Verify the immutable G1 Git baseline,
    # including Windows checkout line-ending conversion, instead of rejecting all development.
    blob=subprocess.check_output(['git','-C',str(REPO),'show',inventory['baseline']+':'+source['path']])
    candidates={hashlib.sha256(blob).hexdigest(),hashlib.sha256(blob.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')).hexdigest()}
    if source['sha256'] not in candidates:
        errors.append('Pinned baseline hash mismatch '+source['path'])
for case in cases:
    if case['id'] not in ('C05','C06'): continue
    data=case['input']; expected=case['expected']; total=sum(data['counts'][t] for t in data['selectedTags'])
    for tag in data['selectedTags']:
        if abs(data['counts'][tag]/total-expected['weights'][tag])>1e-9: errors.append('Weight '+case['id'])
    for work,strength in data['strengths'].items():
        calculated=round(sum(data['counts'][t]/total*strength[t] for t in data['selectedTags']),3)
        if calculated!=expected['scores'][work]: errors.append('Score '+case['id'])
mapping=(ROOT/'issue-implementation-map.md').read_text(encoding='utf-8')
for sample in wire:
    profile=sample['request'].get('tasteProfile',{})
    if profile.get('source')=='saved' and not profile.get('savedProfileVersion'):
        errors.append('Missing savedProfileVersion '+sample['name'])
    if profile.get('source')=='saved' and any(v.get('when')=='no Bearer guest' for v in sample.get('responseVariants',[])):
        errors.append('Guest cannot use authenticated saved profile '+sample['name'])
for issue in plan['issues']:
    if len(re.findall(r'^\| '+issue['id']+r' \|',mapping,re.M))!=1: errors.append('Issue map '+issue['id'])
result={'ok':not errors,'sourceFiles':len(inventory['sources']),'baselineRoutes':len(inventory['routes']),
        'directFrontendCalls':len(inventory['calls']),'contractCases':len(cases),'wireExamples':len(wire),'mappedIssues':len(plan['issues']),
        'errors':errors,'scope':'Static examples/pinned Git baseline/map integrity only; current worktree and target API acceptance are separate.'}
(ROOT/'contract-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
raise SystemExit(0 if result['ok'] else 1)
