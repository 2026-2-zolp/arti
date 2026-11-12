# 상세 계획의 순서·검증 대응·금지범위와 과거 소스를 검사합니다. 제품/DB/모델은 실행하지 않습니다.
import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
DECISIONS = {f'D{i}' for i in range(1, 8)}


def load(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


def validate(plan):
    assert plan['permissionScope'] == 'planning_only'
    assert plan['status'] == 'implementation_not_started'
    for key in ('productApplied', 'selectionFinal', 'publicActivation', 'remotePush', 'formalGatesPromoted'):
        assert plan[key] is False, key
    assert plan['invariants'] == {'maxTags': 8, 'recommendationCounts': [3, 5, 7], 'thresholdChanges': False,
                                  'retraining': False, 'finalSurveySize': 10, 'surveyPairs': 5,
                                  'previewLogicalWrites': 0, 'referenceIsProductImplementation': False,
                                  'concurrencyDatabase': 'PostgreSQL'}
    isolation = plan['isolation']
    assert isolation['ordinaryProject'] == 'arti-dev' and isolation['ordinaryWritesAllowed'] is False
    assert isolation['gptCallsAllowed'] == 0 and isolation['autoDownloadsAllowed'] is False and isolation['publicActivationAllowed'] is False
    assert isolation['futureProject'] != isolation['ordinaryProject']
    assert len({isolation['suggestedApiPort'], isolation['suggestedUiPort'], 4018, 5178}) == 4
    phases = plan['phases']
    assert [p['id'] for p in phases] == ['TP1', 'TP2', 'TP3', 'TP4']
    cases = {c['id']: c for c in plan['verificationCases']}
    assert len(cases) == len(plan['verificationCases']) == 26
    created = set()
    covered = []
    for index, phase in enumerate(phases):
        assert phase['dependsOn'] == ([] if index == 0 else [phases[index-1]['id']])
        assert phase['status'] == 'planned' and phase['gate'] == 'not_run'
        assert all(phase[k] for k in ('files', 'entry', 'done', 'rollback', 'commits', 'caseIds', 'expectedEvidence'))
        paths = [f['path'] for f in phase['files']]
        assert len(paths) == len(set(paths))
        for row in phase['files']:
            path = PurePosixPath(row['path'])
            assert not path.is_absolute() and '..' not in path.parts
            assert not (path.name.startswith('.env') and not path.name.endswith('.example'))
            assert row['purpose'] and row['state'] in ('existing', 'proposed_new', 'created_in_prior_phase')
            if row['state'] == 'existing': assert (ROOT / row['path']).is_file(), row['path']
            if row['state'] == 'created_in_prior_phase': assert row['path'] in created
            if row['state'] == 'proposed_new': created.add(row['path'])
        for case_id in phase['caseIds']:
            assert case_id in cases and case_id.startswith('P'+phase['id'][-1]+'-')
        covered += phase['caseIds']
    assert set(covered) == set(cases) and len(covered) == len(cases)
    for case in cases.values():
        assert case['status'] == 'not_run'
        assert all(case[k] for k in ('topic', 'action', 'expected', 'evidence', 'kind'))
    assert {'provenance', 'atomic_analysis', 'snapshot_race', 'cas', 'lost_response', 'legacy', 'history_proof',
            'feature_disable', 'draft', 'response_order', 'save_failure', 'ui_merge', 'journey', 'real_model',
            'ordinary_preservation', 'ci', 'rollback'} <= {c['topic'] for c in cases.values()}
    assert set(plan['decisions']) == DECISIONS


def pinned_blobs(commit, names):
    # batch로 Git 근거를 읽고 실제 비밀 env나 네트워크는 접근하지 않습니다.
    raw = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=ROOT,
                                  input=''.join(commit+':'+name+'\n' for name in names).encode('utf-8'))
    cursor = 0
    result = {}
    for name in names:
        end = raw.index(b'\n', cursor)
        header = raw[cursor:end].decode('ascii').split()
        assert len(header) == 3 and header[1] == 'blob', name
        size = int(header[2]); start = end + 1
        result[name] = raw[start:start+size]
        cursor = start + size + 1
    return result


def reject_probes(plan):
    def change_phase(index, key, value):
        def apply(p): p['phases'][index][key] = value
        return apply
    probes = {
        'product_applied': lambda p: p.update(productApplied=True),
        'phase_premature_pass': change_phase(1, 'gate', 'passed'),
        'phase_dependency_cycle': change_phase(0, 'dependsOn', ['TP4']),
        'future_case_premature_pass': lambda p: p['verificationCases'][0].update(status='passed'),
        'missing_rollback': change_phase(2, 'rollback', []),
        'ordinary_db_write': lambda p: p['isolation'].update(ordinaryWritesAllowed=True),
        'live_env_target': lambda p: p['phases'][0]['files'][0].update(path='.env.compose'),
        'fixture_selected_as_final': lambda p: p.update(selectionFinal=True),
        'case_mapping_lost': lambda p: p['phases'][1]['caseIds'].pop(),
        'automatic_model_download': lambda p: p['isolation'].update(autoDownloadsAllowed=True),
    }
    for label, mutate in probes.items():
        altered = copy.deepcopy(plan); mutate(altered)
        try: validate(altered)
        except AssertionError: continue
        raise AssertionError('unsafe plan accepted: '+label)
    return list(probes)


def verify(planning_worktree=False):
    plan = load('plan.json'); baseline = load('baseline.json'); review = load('review.json')
    validate(plan)
    assert plan['baselineCommit'] == baseline['commit'] == '9234371'
    subprocess.run(['git', 'merge-base', '--is-ancestor', baseline['commit'], 'HEAD'], cwd=ROOT, check=True)
    expected = baseline['sourceHashes'] | baseline['contractRecordFiles']
    formal = 'docs/execution-plan/2026-11-07/execution.json'
    expected[formal] = baseline['formalStateSha256']
    blobs = pinned_blobs(baseline['commit'], list(expected))
    for name, sha in expected.items():
        assert hashlib.sha256(blobs[name].replace(b'\r\n', b'\n')).hexdigest() == sha, name
        if planning_worktree:
            assert hashlib.sha256((ROOT/name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() == sha, name
    if planning_worktree:
        assert not subprocess.check_output(['git', 'diff', '--', 'frontend', 'backend-django', 'ai-service', 'compose.yaml', '.env.example', '.env.compose.example', '.github/workflows/ci.yml'], cwd=ROOT)
        assert all(not (ROOT/f['path']).exists() for p in plan['phases'] for f in p['files'] if f['state'] == 'proposed_new')
    assert review['codeApplied'] is False
    valid_cases = {c['id'] for c in plan['verificationCases']}
    for finding in review['findings']:
        assert finding['resolution'] == 'addressed_in_plan_not_in_product'
        assert finding['decision'] in DECISIONS and set(finding['futureCases']) <= valid_cases
    assert set(re.findall(r'^## (D[1-7]) ', (HERE/'decisions.md').read_text(encoding='utf-8'), re.M)) == DECISIONS
    links = 0
    for file in HERE.glob('*.md'):
        for target in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
            if '://' in target or target.startswith('#'): continue
            assert (file.parent/target.split('#')[0]).is_file(), (file, target)
            links += 1
    probes = reject_probes(plan)
    result = {'ok': True, 'scope': 'planning readiness only;no product/PG/browser/model/human execution acceptance',
              'phasesPlanned': 4, 'futureCases': 26, 'futureCasesRun': 0, 'newDecisions': 7,
              'roleBasedFindings': len(review['findings']), 'pinnedProductFiles': len(baseline['sourceHashes']),
              'pinnedContractFiles': len(baseline['contractRecordFiles']), 'planningWorktreeUnchanged': planning_worktree,
              'localLinks': links, 'negativePlanProbesRejected': probes}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--planning-worktree', action='store_true', help='제품 미적용의 이번 작업 시점 검사;향후 구현 후에는 사용하지 않음')
    verify(parser.parse_args().planning_worktree)
