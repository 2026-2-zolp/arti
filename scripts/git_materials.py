# Git 참조 자료의 파일·메타데이터·해시 정합성을 점검합니다.
"""Read-only inventory/contracts for existing Git material; no model, DB or network."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAGS = {'landscape','people','abstract','light','vivid','cool','warm','soft'}


def digest(path):
    raw = path.read_bytes()
    if path.suffix == '.json':
        raw = json.dumps(json.loads(raw),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    elif path.suffix == '.csv':
        raw = path.read_text(encoding='utf-8').encode()
    return hashlib.sha256(raw).hexdigest()


def inside(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Unsafe material path: '+str(relative))
    return path


def captures(root=ROOT):
    evaluation=root/'ai-service/evaluation'
    metadata=evaluation/'tag_eval_set.json'
    descriptions=root/'data/reference/git-captures/capture-descriptions.json'
    items=json.loads(metadata.read_text(encoding='utf-8'))['items']
    draft=json.loads(descriptions.read_text(encoding='utf-8'))
    expected={f'{i:02}' for i in range(1,41)}
    if len(items)!=40 or {r['id'] for r in items}!=expected or set(draft['items'])!=expected:
        raise ValueError('Capture metadata/description IDs must match exactly 01..40, once each.')
    rows=[]
    for item in items:
        if any(not isinstance(item.get(k),str) or not item[k].strip() for k in ('title','artist')):
            raise ValueError('Missing title/artist: '+item['id'])
        tags=item.get('expected')
        if not isinstance(tags,list) or not tags or len(tags)!=len(set(tags)) or not set(tags)<=TAGS or item.get('primary') not in tags:
            raise ValueError('Invalid capture tag labels: '+item['id'])
        text=draft['items'][item['id']]
        from urllib.parse import urlsplit
        url=urlsplit(text.get('url',''))
        if not isinstance(text.get('text'),str) or not text['text'].strip() or url.scheme not in ('https','http') or not url.hostname or url.username or url.password:
            raise ValueError('Missing/invalid draft description or source URL: '+item['id'])
        image=inside(evaluation,item['imagePath'])
        if not image.is_file():
            candidates=[evaluation/'images'/(item['id']+ext) for ext in ('.jpg','.png','.jpeg','.webp')]
            matches=[p for p in candidates if p.is_file()]
            if len(matches)!=1:raise ValueError('Ambiguous/missing image: '+item['id'])
            image=inside(evaluation,matches[0].relative_to(evaluation))
        sha=hashlib.sha256(image.read_bytes()).hexdigest()
        rows.append({'id':'cap-'+item['id'],'title':item['title'],'artist':item['artist'],'year':item.get('year',''),
                     'description':text['text'],'referenceUrl':text['url'],'declaredImagePath':item['imagePath'],
                     'pathCorrected':image!=inside(evaluation,item['imagePath']),'file':sha+image.suffix.lower(),
                     'sha256':sha,'originalPath':image.relative_to(root.resolve()).as_posix()})
    return metadata,descriptions,draft,rows


def audit(root=ROOT):
    provenance=json.loads((root/'data/reference/git-captures/provenance.json').read_text(encoding='utf-8'))
    reference=inside(root,provenance['referenceFile'])
    raw=reference.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=provenance['referenceSha256'] or len(raw)!=provenance['referenceBytes']:
        raise ValueError('Reference draft differs from preserved provenance.')
    if hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()!=provenance['sourceBlob']:
        raise ValueError('Reference Git blob differs from provenance.')
    for asset in provenance['assets']:
        path=inside(root,asset['path'])
        if not path.is_file() or digest(path)!=asset['sha256']:
            raise ValueError('Missing/changed material: '+asset['path'])
    metadata,descriptions,draft,rows=captures(root)
    images=root/'ai-service/evaluation/images'
    image_files=[p for p in images.iterdir() if p.suffix.lower() in ('.jpg','.png','.jpeg','.webp')]
    expected_images={a['path'] for a in provenance['assets'] if a['path'].startswith('ai-service/evaluation/images/') and Path(a['path']).suffix.lower() in ('.jpg','.png','.jpeg','.webp')}
    if {p.relative_to(root).as_posix() for p in image_files}!=expected_images:
        raise ValueError('Image inventory differs; review new/missing material explicitly.')
    wiki=sorted(p for p in image_files if p.name.startswith('wikiart'))
    if len(wiki)!=79 or len(json.loads((root/'ai-service/evaluation/eval_set.json').read_text(encoding='utf-8'))['items'])!=11:
        raise ValueError('Unexpected WikiArt files or example emotion cases.')
    groups={}
    for image in sorted(image_files):
        groups.setdefault(digest(image),[]).append(image.name)
    return {'ok':True,'captureWorks':40,'captureImagesVerified':len(rows),'pathCorrections':sum(r['pathCorrected'] for r in rows),
            'wikiArtImageFiles':len(wiki),'exampleEmotionCases':11,'checkedAt':draft.get('checkedAt'),
            'duplicateImageHashGroups':[g for g in groups.values() if len(g)>1],
            'referenceSha256':provenance['referenceSha256'],'assetsVerified':len(provenance['assets']),
            'warnings':['Source URLs are syntactically checked, not browsed or fact-checked.',
                        'AI draft; no human approval inferred. WikiArt files are not 79 approved/labelled service works.',
                        'No Yoo Youngkuk exhibition intake; local unique DB/uploads remain unknown/separate.'],
            'writesToDatabase':False,'approvedWorks':0}


if __name__=='__main__':
    try:
        print(json.dumps(audit(),ensure_ascii=True,indent=2))
    except (ValueError,KeyError,TypeError,OSError) as exc:
        raise SystemExit('Material audit failed: '+str(exc))
