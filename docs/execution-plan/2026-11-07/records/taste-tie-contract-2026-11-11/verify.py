# 동점 계약의 합성 반례와 실제 소스/공식 상태 보존을 검사합니다. 제품·DB·모델을 실행하지 않습니다.
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / 'scripts'))
from taste_tie_contract import TAGS, verify_cases


def verify():
    baseline = json.loads((HERE / 'baseline.json').read_text(encoding='utf-8'))
    for path, expected in baseline['sourceHashes'].items():
        actual = hashlib.sha256((ROOT / path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        assert actual == expected, path
    assert hashlib.sha256((ROOT / 'docs/execution-plan/2026-11-07/execution.json').read_bytes()).hexdigest() == baseline['formalStateSha256']
    constants = ast.parse((ROOT / 'backend-django/arti/constants.py').read_text(encoding='utf-8'))
    actual_tags = next(ast.literal_eval(node.value) for node in constants.body
                       if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'TAGS' for t in node.targets))
    assert TAGS == actual_tags
    tracked = subprocess.check_output(['git', 'ls-files', '-z', '--', 'frontend/src', 'backend-django', 'ai-service/app'], cwd=ROOT).decode('utf-8').strip('\0').split('\0')
    for name in tracked:
        file = ROOT / name
        if file.suffix in ('.ts', '.tsx', '.py'):
            assert 'taste_tie_contract' not in file.read_text(encoding='utf-8'), file
    result = verify_cases()
    stored = json.loads((HERE / 'results.json').read_text(encoding='utf-8'))
    assert result == stored
    links = 0
    for file in HERE.glob('*.md'):
        for target in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
            if '://' in target or target.startswith('#'): continue
            assert (file.parent / target.split('#')[0]).exists(), (file, target)
            links += 1
    intake = json.loads((HERE / 'frontend-intake.json').read_text(encoding='utf-8'))
    assert intake['sameCount'] == 52 and intake['changedCount'] == 23
    assert intake['addedCount'] == intake['missingSourceCount'] == 0
    report = {'ok': True, 'syntheticCases': len(result['cases']), 'protectedProductFiles': len(baseline['sourceHashes']),
              'formalStatePreserved': True, 'productImportsReferenceModel': False, 'localLinks': links,
              'frontendZipStaticOnly': True, 'scope': 'contract preparation only;no product/human/model quality gate promotion'}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == '__main__':
    verify()
