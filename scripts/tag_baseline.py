# 기존 40점의 고정 점수와 평가자별 기준을 비교합니다. 제품 설정/라벨은 변경하지 않습니다.
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'ai-service'))
from app.tags import TAG_KEYS


def metrics(predictions, labels, masks=None):
    # 동점/결측은 음성으로 간주하지 않고 평가에서 제외합니다.
    if not labels or len(predictions) != len(labels) or (masks is not None and len(masks) != len(labels)):
        raise ValueError('nonempty aligned evaluation inputs required')
    masks = masks or [{k: True for k in TAG_KEYS} for _ in labels]
    per = {}; total = [0, 0, 0]
    for k in TAG_KEYS:
        pairs = [(p[k], k in y) for p, y, mask in zip(predictions, labels, masks) if mask[k]]
        tp = sum(p and y for p, y in pairs)
        fp = sum(p and not y for p, y in pairs)
        fn = sum(not p and y for p, y in pairs)
        precision = tp / (tp + fp) if tp + fp else 0.
        recall = tp / (tp + fn) if tp + fn else None
        f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
        per[k] = dict(precision=precision, recall=recall, f1=f1, positiveSupport=sum(y for _, y in pairs), cells=len(pairs))
        total = [a+b for a,b in zip(total, [tp, fp, fn])]
    tp, fp, fn = total
    valid = [v['f1'] for v in per.values() if v['positiveSupport'] > 0]
    return dict(macroF1=sum(valid)/len(valid) if valid else None,
                microF1=2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,
                meanPredictedTags=sum(sum(p.values()) for p in predictions)/len(predictions),
                perTag=per, evaluatedCells=sum(v['cells'] for v in per.values()),
                macroDefinition='mean over tags with positive support; unsupported tags excluded and reported')


def consensus(rows, ids):
    votes = [{k: sum(k in row[i]['tags'] for row in rows) for k in TAG_KEYS} for i in ids]
    n = len(rows)
    labels = [{k for k in TAG_KEYS if v[k]*2 > n} for v in votes]
    masks = [{k: v[k]*2 != n for k in TAG_KEYS} for v in votes]
    return labels, masks, votes


def report(scores, items, raters, thresholds):
    ids = [x['id'] for x in items]
    raw = [scores[i]['scores'] for i in ids]
    modes = {'raw_half': [{k:r[k]>=.5 for k in TAG_KEYS} for r in raw],
             'current': [{k:r[k]>=thresholds[k] for k in TAG_KEYS} for r in raw],
             'all_positive_sanity': [{k:True for k in TAG_KEYS} for _ in raw]}
    # 기존 기록상 한 명은 다중 라벨 수집이 아니라 대표 태그만 제공했습니다.
    primary_only = {'김동섭'}
    multi = [name for name in sorted(raters) if name not in primary_only]
    rows = [raters[n] for n in multi]
    labels, masks, votes = consensus(rows, ids)
    out = {'scope':'fixed baseline comparison, no threshold fitting, no unbiased holdout claim',
           'sampleCount':len(ids), 'raterCount':len(raters), 'multiLabelRaterCount':len(multi),
           'savedMajority':{}, 'strictMajority':{}, 'perRater':[], 'leaveOneRaterOut':[],
           'consensusBands':{}, 'disagreements':[]}
    for mode, pred in modes.items():
        value = metrics(pred, [set(x['expected']) for x in items])
        value['primaryInclusionRate'] = sum(p[x['primary']] for p,x in zip(pred,items))/len(items)
        value['scoreArgmaxPrimaryAccuracy'] = sum(max(TAG_KEYS,key=lambda k:r[k]) == x['primary'] for r,x in zip(raw,items))/len(items)
        out['savedMajority'][mode] = value
        out['strictMajority'][mode] = metrics(pred, labels, masks)
    for index, name in enumerate(sorted(raters), 1):
        row = raters[name]; available = [i for i in ids if i in row]
        indices = [ids.index(i) for i in available]
        result = {'raterId':f'R{index}', 'primaryOnly':name in primary_only, 'samples':len(available), 'modes':{}}
        for mode,pred in modes.items():
            value = {'primaryInclusionRate':sum(pred[j][row[i]['primary']] for i,j in zip(available,indices))/len(available)}
            if name not in primary_only:
                value.update(metrics([pred[j] for j in indices], [row[i]['tags'] for i in available]))
            result['modes'][mode]=value
        out['perRater'].append(result)
    for name in multi:
        y, mask, _ = consensus([raters[n] for n in multi if n != name], ids)
        out['leaveOneRaterOut'].append({'excludedRaterId':f'R{sorted(raters).index(name)+1}',
            'tiedCellsExcluded':sum(not x for m in mask for x in m.values()),
            'modes':{mode:metrics(pred,y,mask) for mode,pred in modes.items()}})
    for band in ['high_agreement','disputed']:
        bandmask=[{k:(max(v[k],len(rows)-v[k])/len(rows)>=.8)==(band=='high_agreement') for k in TAG_KEYS} for v in votes]
        out['consensusBands'][band]={mode:metrics(pred,labels,bandmask) for mode,pred in modes.items()}
    for item,v in zip(items,votes):
        if any(0<v[k]<len(rows) for k in TAG_KEYS):
            out['disagreements'].append({'id':item['id'],'positiveVotes':v,'voters':len(rows)})
    return out


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--infer',action='store_true')
    args=parser.parse_args(); args.output.mkdir(parents=True,exist_ok=True)
    base=ROOT/'ai-service/evaluation'
    items=json.loads((base/'tag_eval_set.json').read_text(encoding='utf-8'))['items']
    paths={}
    for item in items:
        declared=base/item['imagePath']
        matches=[declared.with_suffix(e) for e in ['.jpg','.png','.jpeg','.webp'] if declared.with_suffix(e).exists()]
        if len(matches)!=1:raise ValueError('missing/ambiguous input '+item['id'])
        paths[item['id']]=matches[0]
    from evaluation.team_tags import read_labels
    raters=read_labels()
    if any(any(i['id'] not in row for i in items) for row in raters.values()):raise ValueError('incomplete raters')
    thresholds=json.loads((ROOT/'ai-service/app/tag_calibration.json').read_text(encoding='utf-8'))['thresholds']
    if args.infer:
        if (args.output/'raw-scores.json').exists():raise ValueError('refuse overwrite of frozen raw scores')
        from app.analyzer import HuggingFaceScorer
        from PIL import Image
        scorer=HuggingFaceScorer(); t=time.perf_counter();scorer.load();load=time.perf_counter()-t
        scores={}
        for item in items:
            path=paths[item['id']]; t=time.perf_counter()
            with Image.open(path) as image: values=scorer.image_tag_scores(image.convert('RGB'))
            if set(values)!=set(TAG_KEYS) or any(not math.isfinite(v) or not 0<=v<=1 for v in values.values()):raise ValueError('invalid score')
            scores[item['id']]={'scores':values,'seconds':time.perf_counter()-t,'imageSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            if len(scores)%10==0:print('inferred',len(scores),flush=True)
        payload={'loadSeconds':load,'items':scores}
        target=args.output/'raw-scores.json'
        if target.exists():raise ValueError('refuse overwrite of frozen raw scores')
        target.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    payload=json.loads((args.output/'raw-scores.json').read_text(encoding='utf-8'))
    if set(payload['items']) != set(paths):raise ValueError('score IDs differ from inputs')
    for key,path in paths.items():
        row=payload['items'][key]
        if row['imageSha256'] != hashlib.sha256(path.read_bytes()).hexdigest():raise ValueError('image changed')
        if set(row['scores']) != set(TAG_KEYS) or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in row['scores'].values()):raise ValueError('invalid frozen scores')
    result=report(payload['items'],items,raters,thresholds)
    result['inputHashes']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [base/'tag_eval_set.json',ROOT/'ai-service/app/tag_calibration.json',*sorted((base/'labeling/responses').glob('*.csv'))]}
    (args.output/'metrics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print({k:{m:round(v['macroF1'],4) for m,v in result[k].items()} for k in ['savedMajority','strictMajority']},flush=True)

if __name__=='__main__':main()
