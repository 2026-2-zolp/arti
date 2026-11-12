# TP1a 실행 기록과 허용 변경 경계를 읽기 전용으로 검사합니다. 시험을 재실행하거나 DB에 접근하지 않습니다.
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]


def load(name):
    return json.loads((HERE/name).read_text(encoding='utf-8'))


def file_hash(name):
    return hashlib.sha256((ROOT/name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


baseline = load('baseline.json')
validation = load('validation.json')
tests = load('tests.json')
allowed = set(baseline['allowedProductChanges'])
preserved = 0
for name, sha in baseline['sourceHashes'].items():
    if name not in allowed:
        assert file_hash(name) == sha, name
        preserved += 1
for name, sha in baseline['contractRecordFiles'].items():
    assert file_hash(name) == sha, name
assert file_hash('docs/execution-plan/2026-11-07/execution.json') == baseline['formalStateSha256']
assert set(validation['implementationHashes']) == allowed
for name, sha in validation['implementationHashes'].items():
    assert file_hash(name) == sha, name
assert validation['status'] == 'passed_tp1a_only'
assert validation['next'] == 'TP1b isolated schema and atomic persistence'
assert all(validation['acceptance'][key] == 'passed' for key in ('A1', 'A2', 'A3', 'A4'))
assert not any(validation[key] for key in ('generalDbChanged', 'publicActivation', 'remotePush', 'realModelQualityClaim'))
assert tests['ai']['passed'] == 38 and tests['django']['passed'] == 23 and tests['scripts']['passed'] == 53
wire = load('synthetic-http-wire.json')
assert wire['ok'] and wire['dbCursorCalls'] == 0 and not wire['realWeights']
assert wire['providerTagKeys'] == ['scores'] and not wire['providerEmotionHasTagEvidence']
result = wire['wire']
evidence = result['tagEvidence']
assert evidence['signature']['modelId'] == result['models']['image']
assert evidence['signatureSha256'] == digest(evidence['signature'])
assert evidence['scoresSha256'] == digest({k: float(v) for k, v in result['tags'].items()})
assert evidence['evidenceSha256'] == digest({k: v for k, v in evidence.items() if k != 'evidenceSha256'})
print(json.dumps({'ok': True, 'preservedSourceFiles': preserved, 'preservedContractFiles': 8,
                  'implementationFiles': len(allowed), 'formalStatePreserved': True,
                  'scope': 'TP1a current-source/record integrity only; tests are recorded prior runs, not rerun here'},
                 ensure_ascii=False, indent=2))
