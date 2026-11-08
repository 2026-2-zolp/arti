"""Bundle committed 40-work assets without executing the legacy approved seed."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def export(destination):
    evaluation=ROOT/'ai-service/evaluation'
    metadata=evaluation/'tag_eval_set.json'
    descriptions=ROOT/'backend/scripts/capture-descriptions.json'
    items=json.loads(metadata.read_text(encoding='utf-8'))['items']
    draft=json.loads(descriptions.read_text(encoding='utf-8'))
    rows=[]
    for item in items:
        declared=item['imagePath']
        image=(evaluation/declared).resolve()
        if not image.is_file():
            candidates=[evaluation/'images'/(item['id']+ext) for ext in ('.jpg','.png','.jpeg','.webp')]
            matches=[p for p in candidates if p.is_file()]
            if len(matches)!=1:raise ValueError('Ambiguous/missing image: '+item['id'])
            image=matches[0].resolve()
        if not image.is_relative_to(evaluation.resolve()) or not image.is_file():raise ValueError('Missing/unsafe asset: '+item['id'])
        digest=hashlib.sha256(image.read_bytes()).hexdigest()
        rows.append({'id':'cap-'+item['id'],'title':item['title'],'artist':item['artist'],'year':item.get('year',''),
                     'description':draft['items'][item['id']]['text'],'referenceUrl':draft['items'][item['id']]['url'],
                     'declaredImagePath':declared,'pathCorrected':image!=(evaluation/declared).resolve(),'file':digest+image.suffix.lower(),'sha256':digest,'originalPath':str(image.relative_to(ROOT)).replace('\\','/')})
    if len(rows)!=40 or len({r['id'] for r in rows})!=40:raise ValueError('Expected 40 unique works.')
    manifest={'version':1,'exhibitionId':'ex-capture','title':'캡처 40점 테스트 전시',
              'source':'Git capture bundle; AI-written draft, NOT official text; review required',
              'checkedAt':draft.get('checkedAt'),'metadataSha256':hashlib.sha256(metadata.read_bytes()).hexdigest(),
              'descriptionsSha256':hashlib.sha256(descriptions.read_bytes()).hexdigest(),'items':rows,
              'limitations':['No local arti.db or manual review state included','No real exhibition coordinates','No user/session import','Not Yoo Youngkuk exhibition']}
    destination.mkdir(parents=True,exist_ok=True)
    for row in rows:shutil.copyfile(ROOT/row['originalPath'],destination/row['file'])
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path);args=parser.parse_args()
    result=export(args.destination)
    print(json.dumps({'works':len(result['items']),'checkedAt':result['checkedAt'],'missingImages':0,'localDbUniqueData':'unknown'},ensure_ascii=True))
