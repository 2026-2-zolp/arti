# 유영국 W06 준비 자료의 누락·충돌·승인 오표시와 고정 입력 변조를 읽기 전용으로 검사합니다.
"""Preparation contracts only. Never import DB data, infer models or approve materials."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD = Path('docs/execution-plan/2026-11-07/records/W06/readiness')
TAGS = {'landscape','people','abstract','light','vivid','cool','warm','soft'}


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def read_inputs(root=ROOT):
    return {name:json.loads((root/RECORD/name).read_text(encoding='utf-8')) for name in
            ['layout-draft.json','pool-decision.json','evaluation-plan.json','human-review-checklist.json']}


def check(inputs):
    layout,pool,plan,review=(inputs[n] for n in ['layout-draft.json','pool-decision.json','evaluation-plan.json','human-review-checklist.json'])
    expected={f'yyk-demo-{i:03}' for i in range(1,17)}
    for value in [layout['items'],plan['items'],review['items']]:
        ids=[i['id'] for i in value]
        if len(ids)!=16 or set(ids)!=expected:raise ValueError('Expected exactly16 distinct stable artwork IDs.')
    if layout['appliedToDatabase'] or layout['physicalRouteClaim'] or layout['widthMeters'] is not None:
        raise ValueError('Draft cannot claim actual route or applied placement.')
    zones={z['id'] for z in layout['zones']}
    for point in layout['items']+[layout['entrance']]:
        if any(type(point[k]) not in (int,float) or not 0<=point[k]<=100 for k in ['x','y']):raise ValueError('Invalid normalized draft position.')
    if len({(i['x'],i['y']) for i in layout['items']})!=16:raise ValueError('Overlapping draft positions.')
    if any(i['zoneId'] not in zones for i in layout['items']):raise ValueError('Unknown conceptual zone.')
    selected=pool['selectedIds']
    if selected!=sorted(expected)[:10] or len(pool['pairs'])!=5:raise ValueError('Pool must preserve currentID-sorted10 contract.')
    paired=[v for pair in pool['pairs'] for v in [pair['leftId'],pair['rightId']]]
    if paired!=selected or any(not p['reason'].strip() for p in pool['pairs']):raise ValueError('Five ordered pairs must cover10 candidates exactly.')
    if pool['readyNow'] or pool['appliedToDatabase']:raise ValueError('Candidate pool is not a live approved pool.')
    if set(plan['tags'])!=TAGS or len(plan['emotions'])!=6:raise ValueError('Evaluation dimensions changed.')
    for item in plan['items']:
        if not set(item['tagHypotheses'])<=TAGS or item['humanReview']!='pending':raise ValueError('Invalid or falsely approved candidate label.')
        if 'not model output/ground truth' not in item['tagLabelAuthority']:raise ValueError('Hypotheses must not masquerade as labels.')
        if not item['sourceUrl'].startswith(('http://','https://')):raise ValueError('Missing source reference.')
        guide=item['guideCandidate']
        if not 1<=len(guide['questions'])<=3 or len(guide['questions'])!=len(guide['hints']):raise ValueError('Invalid guide pairs.')
    if plan['sampleOrder']!=sorted(expected):raise ValueError('Explicit sample order missing.')
    if len(plan['evaluation']['hardFailures'])<6 or not plan['dialogueExamples']['easy'] or not plan['dialogueExamples']['deep']:
        raise ValueError('Incomplete pre-inference evaluation rules.')
    for item in review['items']:
        if item['status']!='pending' or item['reviewer'] is not None or item['reviewedAt'] is not None or set(item['decisions'].values())!={'pending'}:
            raise ValueError('User confirmed team review has not happened; do not invent approval.')
    return {'ok':True,'works':16,'draftPositions':16,'poolCandidates':10,'pairs':5,'teamReviewsPending':16,'scope':'preparation contract only; not W06 human approval or real model/journey acceptance'}


def verify(root=ROOT):
    inputs=read_inputs(root); result=check(inputs)
    frozen=json.loads((root/RECORD/'frozen-inputs.json').read_text(encoding='utf-8'))
    for name,value in inputs.items():
        if digest(value)!=frozen['canonicalJsonSha256'][name]:raise ValueError('Frozen input changed: '+name)
    rows=[]
    for name in ['core3-manifest.json','remaining12-manifest.json','007-manifest.json']:
        rows+=json.loads((root/'data/intake/2026-11-09-yoo-youngkuk'/name).read_text(encoding='utf-8'))['items']
    originals={r['id']:r for r in rows}
    for item in inputs['evaluation-plan.json']['items']:
        original=originals[item['id']]
        if any(item[k]!=original[k] for k in ['recordId','assetId']) or item['originalSha256']!=original['sha256']:
            raise ValueError('Artwork/file identity mapping mismatch.')
    return result


if __name__=='__main__':
    print(json.dumps(verify(),ensure_ascii=True,indent=2))
