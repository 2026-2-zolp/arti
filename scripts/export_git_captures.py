# 기존 Git 캡처 자료를 해시·근거와 함께 인수 묶음으로 내보냅니다.
"""Bundle committed 40-work assets without executing the legacy approved seed."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
try:
    from .git_materials import ROOT, audit, captures
except ImportError:
    from git_materials import ROOT, audit, captures



def export(destination, root=ROOT):
    root=root.resolve()
    audit(root)  # Validate before producing any output; never execute a legacy seed.
    metadata,descriptions,draft,rows=captures(root)
    manifest={'version':1,'exhibitionId':'ex-capture','title':'캡처 40점 테스트 전시',
              'source':'Git capture bundle; AI-written draft, NOT official text; review required',
              'checkedAt':draft.get('checkedAt'),'metadataSha256':hashlib.sha256(metadata.read_bytes()).hexdigest(),
              'descriptionsSha256':hashlib.sha256(descriptions.read_bytes()).hexdigest(),'items':rows,
              'limitations':['No local arti.db or manual review state included','No real exhibition coordinates','No user/session import','Not Yoo Youngkuk exhibition']}
    destination=destination.resolve()
    if destination==root.resolve() or destination.is_relative_to(root/'backend') or destination.is_relative_to(root/'ai-service') or destination.is_relative_to(root/'data/reference'):
        raise ValueError('Export destination must not overwrite source material.')
    destination.mkdir(parents=True,exist_ok=False)
    for row in rows:shutil.copyfile(root/row['originalPath'],destination/row['file'])
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path);args=parser.parse_args()
    result=export(args.destination)
    print(json.dumps({'works':len(result['items']),'checkedAt':result['checkedAt'],'missingImages':0,'localDbUniqueData':'unknown'},ensure_ascii=True))
