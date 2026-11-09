# 표시 계약의 분모·불확실성 경계와 고정 오류 사례를 검사합니다. 제품 피드백 API가 아닙니다.
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
RECORD=ROOT/'docs/execution-plan/2026-11-07/records/W07-preparation/ai-review-2026-11-09'


def vote_summary(positive, negative, unknown=0, exposed=None, public_helpfulness=False):
    values=[positive,negative,unknown]+([] if exposed is None else [exposed])
    if any(type(v) is not int or v<0 for v in values):raise ValueError('nonnegative integer counts required')
    responses=positive+negative+unknown;valid=positive+negative
    if exposed is not None and exposed<responses:raise ValueError('responses exceed exposures')
    return {'positive':positive,'validJudgments':valid,'unknown':unknown,'responses':responses,
            'positivePercent':None if not valid or (public_helpfulness and valid<10) else round(100*positive/valid,1),
            'responsePercent':None if not exposed else round(100*responses/exposed,1),
            'scope':'positive percentage excludes unknown; response percentage includes unknown'}


def model_score(value):
    import math
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1:raise ValueError('invalid score')
    return {'label':'모델 연관 점수','value':round(value,3),'unit':'score','isProbability':False}


def check_contract(c):
    if c['modelScores']['display']!='score' or c['modelScores']['sumTo100']:raise ValueError('score probability confusion')
    if not c['humanOpinions']['showCounts'] or c['humanOpinions']['unknownIsNegative']:raise ValueError('opinion denominator confusion')
    if c['feedback']['autoApprove'] or c['feedback']['autoTrain']:raise ValueError('feedback cannot directly approve or train')
    if not {'targetRevision','modelConfigVersion'}.issubset(c['feedback']['required']):raise ValueError('unversioned feedback')
    if len(set(c['feedback']['targetKinds']))!=4:raise ValueError('feedback scopes merged')


def main():
    contract=json.loads((RECORD/'presentation-contract.json').read_text(encoding='utf-8'));check_contract(contract)
    errors=json.loads((RECORD/'error-cases.json').read_text(encoding='utf-8'))
    base=RECORD.parent/'tag-baseline-2026-11-09'
    assert errors['sourceScoresSha256']==hashlib.sha256((base/'raw-scores.json').read_bytes()).hexdigest()
    cases=errors['cases']
    from tag_baseline import ROOT as BASE_ROOT
    import sys
    sys.path.insert(0,str(BASE_ROOT/'ai-service'))
    from evaluation.team_tags import read_labels
    raters={k:v for k,v in read_labels().items() if k!='김동섭'}
    original={x['id']:x for x in json.loads((BASE_ROOT/'ai-service/evaluation/tag_eval_set.json').read_text(encoding='utf-8'))['items']}
    scores=json.loads((base/'raw-scores.json').read_text(encoding='utf-8'))['items']
    for row in cases:
        key=row['id'];tag=row['tag'];threshold={'vivid':.9,'cool':.5}[tag]
        score=scores[key]['scores'][tag]
        if row['rawScore']!=score or row['rawThreshold']!=threshold or row['imageSha256']!=scores[key]['imageSha256']:raise ValueError('case score/hash changed')
        if row['positiveVotes']!=sum(tag in r[key]['tags'] for r in raters.values()) or row['voters']!=len(raters):raise ValueError('case vote changed')
        predicted=score>=threshold;expected=tag in original[key]['expected']
        if predicted==expected or row['comparison']!=('FP' if predicted else 'FN'):raise ValueError('case classification changed')
    assert len(cases)==18 and len({(x['id'],x['tag']) for x in cases})==18
    assert sum(x['tag']=='vivid' and x['comparison']=='FP' for x in cases)==8
    assert sum(x['tag']=='cool' and x['comparison']=='FP' for x in cases)==7
    assert sum(x['tag']=='cool' and x['comparison']=='FN' for x in cases)==3
    result={'ok':True,'scope':'review artifacts only; no production feedback implementation',
            'cases':18,'examples':{'model':model_score(.74),'team':vote_summary(3,2),
            'helpful':vote_summary(8,2,exposed=20,public_helpfulness=True),
            'unknown':vote_summary(3,1,unknown=1),'small':vote_summary(2,0,public_helpfulness=True),
            'none':vote_summary(0,0)},'gateStatusUnchanged':True}
    (RECORD/'validation.json').write_bytes((json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode())
    print('18 cases and display/feedback boundaries passed')

if __name__=='__main__':main()
