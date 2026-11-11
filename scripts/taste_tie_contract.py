# 동점 계약의 합성 반례를 검사하는 순수 참조 모델입니다. 제품 API·추천·DB에서 사용하지 않습니다.
import argparse
import copy
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / 'docs/execution-plan/2026-11-07/records/taste-tie-contract-2026-11-11'
TAGS = ('landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft')
POLICY = 'frequency-ai-tie-v1'
TAG_DEFINITION = 'arti-eight-tags-v1'
SIGNATURE_FIELDS = {'modelId', 'modelRevision', 'promptPreprocessSha256', 'calibrationSha256',
                    'tagDefinitionVersion', 'scoreDefinitionVersion'}


class SpecError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def fingerprint(value):
    # 잘못된 모델 값도 결측으로 추적하되 NaN을 정상 JSON 숫자로 저장하지 않습니다.
    def clean(x):
        if isinstance(x, float) and not math.isfinite(x):
            return {'invalidNumber': str(x)}
        if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
        if isinstance(x, list): return [clean(v) for v in x]
        return x
    return hashlib.sha256(json.dumps(clean(value), ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def evidence_version(rows, signature, pool_version):
    """현재 제품의 poolVersion과 별개인 향후 점수 근거 버전의 참조 계산입니다."""
    normalized = []
    for row in rows:
        scores = row.get('scores') if isinstance(row.get('scores'), dict) else {}
        normalized.append({k: row.get(k) for k in ('id', 'tagStatus', 'signature', 'tagSource', 'scoreRevision', 'imageSha256')} |
                          {'tags': [t for t in TAGS if t in row.get('tags', [])],
                           'scoresUnits': {t: score_units(scores.get(t)) for t in TAGS}})
    return fingerprint({'policyVersion': POLICY, 'tagDefinitionVersion': TAG_DEFINITION, 'poolVersion': pool_version,
                        'approvedSignature': signature, 'orderedPoolRows': normalized})


def score_units(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
        return None
    # 6자리 반올림 후 정수 합산해 비교 순환과 부동소수점 epsilon 정렬을 피합니다.
    return int(Decimal(str(value)).quantize(Decimal('0.000001'), rounding=ROUND_HALF_UP) * 1000000)


def validate_tags(values):
    if not isinstance(values, list) or not values or len(values) > 8 or any(t not in TAGS for t in values) or len(set(values)) != len(values):
        raise SpecError('VALIDATION_ERROR')


def valid_signature(signature):
    return (isinstance(signature, dict) and set(signature) == SIGNATURE_FIELDS
            and all(isinstance(v, str) and v for v in signature.values())
            and signature['tagDefinitionVersion'] == TAG_DEFINITION
            and signature['scoreDefinitionVersion'] == 'image-calibrated-tag-v1'
            and all(len(signature[k]) == 64 and all(c in '0123456789abcdef' for c in signature[k])
                    for k in ('promptPreprocessSha256', 'calibrationSha256')))


def verified_selection(request):
    rows = request['poolRows']
    if request.get('ready') is not True or request['poolVersion'] != request['currentPoolVersion']:
        raise SpecError('VERSION_CONFLICT')
    if len(rows) != 10 or len({r['id'] for r in rows}) != 10 or any(r.get('tagStatus') != 'confirmed' for r in rows):
        raise SpecError('VERSION_CONFLICT')
    current_evidence = evidence_version(rows, request.get('approvedSignature'), request['currentPoolVersion'])
    if request['evidenceVersion'] != current_evidence:
        raise SpecError('VERSION_CONFLICT')
    picks = request['picks']
    if not isinstance(picks, list) or len(picks) != 5:
        raise SpecError('VALIDATION_ERROR')
    chosen = []
    seen = set()
    for p in picks:
        index = p.get('pairIndex')
        if type(index) is not int or index not in range(5) or index in seen:
            raise SpecError('VALIDATION_ERROR')
        seen.add(index)
        row = next((r for r in rows[2*index:2*index+2] if r['id'] == p.get('artworkId')), None)
        if row is None: raise SpecError('VALIDATION_ERROR')
        validate_tags(row['tags'])
        chosen.append(row)
    counts = {t: 0 for t in TAGS}
    for row in chosen:
        for t in row['tags']: counts[t] += 1
    if any(counts[t] == 0 for t in request['selectedTags']):
        raise SpecError('VALIDATION_ERROR')
    return chosen, counts


def comparable_totals(group, chosen, approved_signature):
    if not valid_signature(approved_signature): return None, 'unverified_signature'
    totals = {t: 0 for t in group}
    for row in chosen:
        if row.get('signature') != approved_signature or row.get('tagSource') != 'image':
            return None, 'incomparable_source'
        if type(row.get('scoreRevision')) is not int or row['scoreRevision'] < 1 or not isinstance(row.get('imageSha256'), str) or len(row['imageSha256']) != 64 or any(c not in '0123456789abcdef' for c in row['imageSha256']):
            return None, 'unverified_score_input'
        scores = row.get('scores')
        if not isinstance(scores, dict): return None, 'missing_scores'
        for tag in group:
            units = score_units(scores.get(tag))
            if units is None: return None, 'missing_or_invalid_score'
            totals[tag] += units
    return totals, 'complete_comparable_scores'


def snapshot_binding(counts, tags):
    return fingerprint({'counts': counts, 'selectedTags': sorted(tags)})


def resolve(request):
    """서버가 확보한 가상 근거만 사용합니다. 클라이언트 counts/점수/순서는 읽지 않습니다."""
    tags = request['selectedTags']
    validate_tags(tags)
    mode = request['mode']
    chosen = []
    frozen = None
    if mode == 'picks':
        chosen, counts = verified_selection(request)
    elif mode == 'manual':
        if request.get('picks') not in ([], None) or request.get('poolVersion') is not None:
            raise SpecError('VALIDATION_ERROR')
        counts = {t: 0 for t in TAGS}
    elif mode == 'saved':
        if request.get('authenticated') is not True: raise SpecError('AUTH_REQUIRED')
        if type(request.get('savedProfileVersion')) is not int or request['savedProfileVersion'] < 1:
            raise SpecError('VALIDATION_ERROR')
        if request.get('savedProfileVersion') != request.get('accountProfileVersion'): raise SpecError('VERSION_CONFLICT')
        if set(tags) != set(request['accountTags']): raise SpecError('VALIDATION_ERROR')
        snapshot = request.get('serverSnapshot')
        if snapshot is None: snapshot = {}
        if not isinstance(snapshot, dict) or ('version' in snapshot and (type(snapshot['version']) is not int or snapshot['version'] not in (1, 2))):
            raise SpecError('STORED_PROFILE_REVIEW_REQUIRED')
        values = snapshot.get('counts', {})
        if not isinstance(values, dict) or any(t not in TAGS or type(v) is not int or not 0 <= v <= 5 for t, v in values.items()):
            raise SpecError('STORED_PROFILE_REVIEW_REQUIRED')
        counts = {t: values.get(t, 0) for t in TAGS}
        evidence = snapshot.get('tieEvidence')
        if snapshot.get('version') == 2 and isinstance(evidence, dict):
            order = evidence.get('orderedTags')
            if (evidence.get('policyVersion') == POLICY and evidence.get('binding') == snapshot_binding(counts, tags)
                    and isinstance(order, list) and len(order) == len(tags) and set(order) == set(tags)):
                frozen = order
    else:
        raise SpecError('VALIDATION_ERROR')
    raw_weights = {t: max(1, counts[t]) for t in tags}
    total_weight = sum(raw_weights.values())
    groups = []
    ordered = []
    for weight in sorted(set(raw_weights.values()), reverse=True):
        group = [t for t in TAGS if t in tags and raw_weights[t] == weight]
        totals = None
        rule = 'canonical_fallback'
        reason = 'legacy_or_manual_without_frozen_tie'
        if len(group) == 1:
            rule, reason = 'frequency', 'no_tie'
        elif mode == 'saved' and frozen is not None:
            group = [t for t in frozen if t in group]
            rule, reason = 'frozen_snapshot', 'no_current_pool_or_model_lookup'
        elif mode == 'picks':
            totals, reason = comparable_totals(group, chosen, request.get('approvedSignature'))
            if totals is not None:
                group.sort(key=lambda t: (-totals[t], TAGS.index(t)))
                rule = 'ai_secondary'
        ordered.extend(group)
        groups.append({'weightUnits': weight, 'tags': group, 'rule': rule, 'reason': reason, 'scoreTotalsUnits': totals})
    return {'tagOrder': ordered, 'counts': counts, 'weights': {t: raw_weights[t]/total_weight for t in TAGS if t in tags},
            'groups': groups, 'readOnly': True, 'policyVersion': POLICY,
            'scope': 'offline contract oracle only;not product ranking or preference accuracy'}


def case_request(records, case):
    """공통 합성 입력에 명시된 값 변경만 적용해 중복 fixture를 줄입니다."""
    value = copy.deepcopy(records['baseRequest'])
    for patch in case['changes']:
        parent = value
        for key in patch['path'][:-1]: parent = parent[key]
        key = patch['path'][-1]
        if patch['op'] == 'set': parent[key] = copy.deepcopy(patch['value'])
        elif patch['op'] == 'delete': del parent[key]
        else: raise ValueError('unknown fixture operation')
    return value


def verify_cases():
    records = json.loads((RECORD / 'cases.json').read_text(encoding='utf-8'))
    results = []
    for case in records['cases']:
        request = case_request(records, case)
        before = fingerprint(request)
        try:
            output = resolve(request)
            assert 'error' not in case['expected'], case['id']
            assert output['tagOrder'] == case['expected']['tagOrder'], case['id']
            if 'rules' in case['expected']:
                assert [g['rule'] for g in output['groups']] == case['expected']['rules'], case['id']
            results.append({'id': case['id'], 'passed': True, 'tagOrder': output['tagOrder'],
                            'rules': [g['rule'] for g in output['groups']]})
        except SpecError as error:
            assert error.code == case['expected'].get('error'), case['id']
            results.append({'id': case['id'], 'passed': True, 'error': error.code})
        assert fingerprint(request) == before, case['id']
    return {'ok': True, 'cases': results, 'scope': 'synthetic contract cases;no product/API/DB application'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='합성 동점 계약 반례를 읽기 전용으로 검사합니다.')
    parser.parse_args()
    print(json.dumps(verify_cases(), ensure_ascii=False, indent=2))
