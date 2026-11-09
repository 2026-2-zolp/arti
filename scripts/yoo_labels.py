# 독립 라벨 응답을 검사합니다. DB 적재·승인·평가 정답 자동 생성은 하지 않습니다.
import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
MANIFEST=ROOT/'docs/review/yoo-2026-11-09/manifest.json'
TAGS={'landscape','people','abstract','light','vivid','cool','warm','soft'}
EMOTIONS={'calm','joy','sadness','tension','awe','nostalgia'}


def validate_manifest(m):
    original={k:v for k,v in m.items() if k!='digest'}
    actual=hashlib.sha256(json.dumps(original,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if actual!=m['digest']:raise ValueError('manifest digest changed')
    ids=[r['id'] for r in m['items']]
    if set(ids)!={f'yyk-demo-{i:03}' for i in range(1,17)} or len(ids)!=16:raise ValueError('manifest must contain16 unique IDs')
    if len({r['sha256'] for r in m['items']})!=16:raise ValueError('ambiguous image hashes')
    source={}
    for file in ['core3-manifest.json','remaining12-manifest.json','007-manifest.json']:
        rows=json.loads((ROOT/'data/intake/2026-11-09-yoo-youngkuk'/file).read_text(encoding='utf-8'))['items']
        source.update({r['id']:r for r in rows})
    for row in m['items']:
        if row['recordId']!=source[row['id']]['recordId'] or row['sha256']!=source[row['id']]['sha256']:raise ValueError('reference differs from intake')



def validate(data,manifest,allow_test=False):
    validate_manifest(manifest)
    keys={'format','version','manifestDigest','tagDefinitionVersion','reviewerAlias','forTesting','createdAt','sampleOrder','completeCount','status','items'}
    if not isinstance(data,dict) or set(data)!=keys:raise ValueError('unexpected response fields')
    if data['format']!='arti-independent-labels' or type(data['version']) is not int or data['version']!=1:raise ValueError('unknown response format')
    if data['manifestDigest']!=manifest['digest'] or data['tagDefinitionVersion']!=manifest['tagDefinitionVersion']:raise ValueError('reference version changed')
    if not isinstance(data['reviewerAlias'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,24}',data['reviewerAlias']):raise ValueError('invalid alias')
    if data['reviewerAlias'].upper().startswith('TEST') and not data['forTesting']:raise ValueError('TEST aliases require test flag')
    if type(data['forTesting']) is not bool or (data['forTesting'] and not allow_test):raise ValueError('test responses cannot enter real review')
    try:
        date=datetime.fromisoformat(data['createdAt'].replace('Z','+00:00'))
        if date.tzinfo is None:raise ValueError()
    except (ValueError,AttributeError):raise ValueError('invalid timestamp')
    refs={r['id']:r for r in manifest['items']}
    order=data['sampleOrder']
    if not isinstance(order,list) or len(order)!=16 or len(set(order))!=16 or set(order)!=set(refs):raise ValueError('invalid sample order')
    if not isinstance(data['items'],list) or len(data['items'])!=16:raise ValueError('16 response rows required')
    seen=set();complete=0;uncertain=0;unanswered=0;judgments=0
    for row in data['items']:
        if set(row)!={'id','imageSha256','imageVerified','tags','emotionReviewed','emotions'}:raise ValueError('unexpected item fields')
        key=row['id']
        if key not in refs or key in seen:raise ValueError('duplicate/unknown artwork')
        seen.add(key)
        if row['imageSha256']!=refs[key]['sha256'] or type(row['imageVerified']) is not bool:raise ValueError('image identity mismatch')
        tags=row['tags']
        if not isinstance(tags,dict) or set(tags)!=TAGS or any(v not in ('yes','no','unsure',None) for v in tags.values()):raise ValueError('explicit eight tag answers required')
        if not row['imageVerified'] and any(v is not None for v in tags.values()):raise ValueError('answered without verified image')
        if row['imageVerified'] and all(v is not None for v in tags.values()):complete+=1
        uncertain+=sum(v=='unsure' for v in tags.values());unanswered+=sum(v is None for v in tags.values());judgments+=sum(v in ('yes','no') for v in tags.values())
        emotions=row['emotions']
        if type(row['emotionReviewed']) is not bool or not isinstance(emotions,list) or any(not isinstance(e,str) or e not in EMOTIONS for e in emotions) or len(set(emotions))!=len(emotions):raise ValueError('invalid emotion opinions')
        if row['emotionReviewed'] and not row['imageVerified']:raise ValueError('emotion review without image')
        if emotions and not row['emotionReviewed']:raise ValueError('unreviewed emotion opinions')
    if type(data['completeCount']) is not int or data['completeCount']!=complete:raise ValueError('completion count mismatch')
    if data['status']!=('submitted' if complete==16 else 'draft'):raise ValueError('completion/approval status mismatch')
    return {'valid':True,'responseStatus':data['status'],'forTesting':data['forTesting'],'completeCount':complete,'validTagJudgments':judgments,'uncertainTagAnswers':uncertain,'unansweredTagCells':unanswered,'contentApproved':False,'teamReviewAccepted':False,'scope':'format check only; independent opinions require human review and cannot auto-approve content'}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('response',type=Path);ap.add_argument('--allow-test',action='store_true');a=ap.parse_args()
    if a.response.stat().st_size>1024*1024:raise ValueError('response too large')
    print(json.dumps(validate(json.loads(a.response.read_text(encoding='utf-8-sig')),json.loads(MANIFEST.read_text(encoding='utf-8')),a.allow_test),ensure_ascii=False,indent=2))

if __name__=='__main__':main()
