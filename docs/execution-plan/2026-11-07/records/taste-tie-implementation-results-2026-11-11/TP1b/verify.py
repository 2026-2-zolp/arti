# TP1b의 변경 허용 범위와 기록 무결성을 검사합니다. DB/모델/테스트를 실행하지 않습니다.
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]


def load(name):
    return json.loads((HERE/name).read_text(encoding='utf-8'))


def sha(name):
    return hashlib.sha256((ROOT/name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()


baseline = load('baseline.json'); validation = load('validation.json'); tests = load('tests.json')
allowed = set(baseline['allowedProductChanges'])
preserved = 0
for name, digest in baseline['sourceHashes'].items():
    if name not in allowed:
        assert sha(name) == digest, name
        preserved += 1
for section in ('contractRecordFiles', 'tp1aRecordFiles'):
    for name, digest in baseline[section].items(): assert sha(name) == digest, name
assert sha('docs/execution-plan/2026-11-07/execution.json') == baseline['formalStateSha256']
assert set(validation['implementationHashes']) == allowed
for name, digest in validation['implementationHashes'].items(): assert sha(name) == digest, name
assert validation['status'] == 'passed_tp1b_only'
assert all(validation['acceptance'][key] == 'passed' for key in ('B1','B2','B3','B4','B5','B6'))
assert tests['django']['passed'] == 138 and tests['django']['newCases'] == 18
assert tests['scripts']['passed'] == 53
assert tests['django']['postgresql'] and tests['django']['independentConnections']
assert validation['next'] == 'TP2 server preview and persistence conflict protection'
assert not any(validation[key] for key in ('generalDbChanged','publicActivation','remotePush','realModelQualityClaim','tieSortingEnabled'))
assert tests['isolation']['name'] != 'arti-dev' and tests['isolation']['ordinaryVolumesAttached'] is False
print(json.dumps({'ok': True, 'preservedSourceFiles': preserved,
                  'preservedTP1aRecords': len(baseline['tp1aRecordFiles']), 'formalStatePreserved': True,
                  'scope': 'TP1b source/record integrity only; recorded prior tests, no runtime rerun'}, indent=2))
