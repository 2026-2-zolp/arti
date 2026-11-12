# 취향 조사 후보의 익명 검수 묶음과 응답을 검증합니다. DB·모델·승인 상태는 변경하지 않습니다.
import argparse
import base64
from datetime import datetime
import hashlib
import json
from pathlib import Path
import random
import re

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'docs/review/taste-survey-2026-11-10'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def validate_matrix(matrix):
    if matrix['selectionFinal'] is not False or matrix['activation'] is not False:
        raise ValueError('review preparation must remain inactive and provisional')
    if matrix['hypothesesAreLabels'] is not False:
        raise ValueError('contrast hypotheses cannot be labels')
    rows = matrix['items']
    ids = {x['id'] for x in rows}
    if len(rows) != 21 or len(ids) != 21 or len({x['sha256'] for x in rows}) != 21:
        raise ValueError('21 unique candidates and hashes required')
    for row in rows:
        path = (ROOT / row['assetPath']).resolve()
        if not path.is_relative_to(ROOT) or not re.fullmatch('[a-f0-9]{64}', row['sha256']):
            raise ValueError('invalid asset reference')
        if row['selectionFinal'] is not False or row['humanReview'] != 'pending':
            raise ValueError('no inferred human approval')
        if not row['sourceUrl'].startswith('https://'):
            raise ValueError('source URL missing')
    seen = set()
    for pair in matrix['pairs']:
        members = pair['items']
        if len(members) != 2 or len(set(members)) != 2 or not set(members) <= ids:
            raise ValueError('invalid pair members')
        key = frozenset(members)
        if key in seen or not all(pair.get(k) for k in ('contrastHypothesis', 'sharedFeatures', 'confounds')):
            raise ValueError('duplicate or undocumented pair')
        seen.add(key)
    if len(seen) != 18 or len({p['id'] for p in matrix['pairs']}) != 18:
        raise ValueError('18 unique documented pairs required')


def make_manifest(matrix):
    """이미지 코드만 전달하고 운영자용 작품ID·가설은 따로 분리합니다."""
    validate_matrix(matrix)
    # 고정 시드는 재현·좌우 반전을 위한 것이며 이용자 무작위 표집을 보장하지 않습니다.
    ordered = sorted(matrix['items'], key=lambda r: digest(['review-code-v1', r['id']]))
    code_for = {row['id']: f'Q{i:02}' for i, row in enumerate(ordered, 1)}
    items = [{'code': code_for[r['id']], 'sha256': r['sha256']} for r in ordered]
    item_order = [x['code'] for x in items]
    random.Random(11010).shuffle(item_order)
    pairs = [{'code': f'R{i:02}', 'left': code_for[p['items'][0]], 'right': code_for[p['items'][1]]}
             for i, p in enumerate(matrix['pairs'], 1)]
    random.Random(11011).shuffle(pairs)
    variants = {'V1': {'itemOrder': item_order, 'pairs': pairs},
                'V2': {'itemOrder': list(reversed(item_order)),
                       'pairs': [{'code': p['code'], 'left': p['right'], 'right': p['left']}
                                 for p in reversed(pairs)]}}
    manifest = {'format': 'arti-survey-blind-pack', 'version': 1, 'items': items, 'variants': variants}
    manifest['digest'] = digest(manifest)
    mapping = {'managerOnly': True, 'matrixDigest': digest(matrix), 'packDigest': manifest['digest'],
               'items': {code_for[r['id']]: r['id'] for r in ordered},
               'pairs': {f'R{i:02}': p['id'] for i, p in enumerate(matrix['pairs'], 1)}}
    return manifest, mapping


def check_manifest(manifest):
    if digest({k: v for k, v in manifest.items() if k != 'digest'}) != manifest['digest']:
        raise ValueError('pack digest changed')
    if manifest['format'] != 'arti-survey-blind-pack' or manifest['version'] != 1:
        raise ValueError('unknown pack')


def template(manifest, variant):
    check_manifest(manifest)
    if variant not in manifest['variants']:
        raise ValueError('unknown variant')
    layout = manifest['variants'][variant]
    hashes = {x['code']: x['sha256'] for x in manifest['items']}
    return {'format': 'arti-survey-blind-response', 'version': 1, 'packDigest': manifest['digest'],
            'variant': variant, 'reviewerAlias': '', 'createdAt': '', 'forTesting': False,
            'exposure': {'modelResults': None, 'managerHypotheses': None, 'otherResponses': None},
            'independentResponse': False, 'status': 'draft',
            'items': [{'code': c, 'sha256': hashes[c], 'quality': None, 'familiarity': None, 'note': ''}
                      for c in layout['itemOrder']],
            'pairs': [{**p, 'choice': None, 'difference': None, 'qualityInfluence': None, 'note': ''}
                      for p in layout['pairs']]}


def validate_response(data, manifest, allow_test=False):
    """응답 완성과 승인·독립 정답을 구별하고,누락·중복·조작된 참조를 거절합니다."""
    check_manifest(manifest)
    expected = template(manifest, data.get('variant'))
    if set(data) != set(expected) or data['format'] != expected['format'] or type(data['version']) is not int or data['version'] != 1:
        raise ValueError('unknown response fields/version')
    if data['packDigest'] != manifest['digest']:
        raise ValueError('wrong pack digest')
    if not isinstance(data['reviewerAlias'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,24}', data['reviewerAlias']):
        raise ValueError('invalid alias')
    if type(data['forTesting']) is not bool or (data['forTesting'] and not allow_test):
        raise ValueError('test response cannot enter real review')
    if data['reviewerAlias'].upper().startswith('TEST') and not data['forTesting']:
        raise ValueError('test alias requires test flag')
    try:
        if datetime.fromisoformat(data['createdAt'].replace('Z', '+00:00')).tzinfo is None:
            raise ValueError()
    except (ValueError, AttributeError):
        raise ValueError('timezone-aware timestamp required')
    exposure = data['exposure']
    if not isinstance(exposure, dict) or set(exposure) != set(expected['exposure']) or any(
            v not in ('yes', 'no', 'unsure', None) for v in exposure.values()):
        raise ValueError('invalid exposure record')
    if type(data['independentResponse']) is not bool:
        raise ValueError('invalid independent-response declaration')
    if not isinstance(data['items'], list) or not isinstance(data['pairs'], list) or len(data['items']) != 21 or len(data['pairs']) != 18:
        raise ValueError('all rows required; unanswered rows must remain null')
    complete_items = complete_pairs = 0
    for row, ref in zip(data['items'], expected['items']):
        if not isinstance(row, dict) or set(row) != set(ref) or any(row[k] != ref[k] for k in ('code', 'sha256')):
            raise ValueError('image identity or order mismatch')
        if row['quality'] not in ('adequate', 'limited', 'unsure', None) or row['familiarity'] not in ('known', 'unknown', 'unsure', None):
            raise ValueError('invalid individual judgment')
        if not isinstance(row['note'], str) or len(row['note']) > 2000:
            raise ValueError('invalid note')
        complete_items += row['quality'] is not None and row['familiarity'] is not None
    for row, ref in zip(data['pairs'], expected['pairs']):
        if not isinstance(row, dict) or set(row) != set(ref) or any(row[k] != ref[k] for k in ('code', 'left', 'right')):
            raise ValueError('pair identity/orientation/order mismatch')
        if row['choice'] not in ('left', 'right', 'both', 'neither', 'unsure', None) or row['difference'] not in ('clear', 'partial', 'little', 'unsure', None) or row['qualityInfluence'] not in ('yes', 'no', 'unsure', None):
            raise ValueError('invalid pair judgment')
        if not isinstance(row['note'], str) or len(row['note']) > 2000:
            raise ValueError('invalid note')
        complete_pairs += all(row[k] is not None for k in ('choice', 'difference', 'qualityInfluence'))
    complete = complete_items == 21 and complete_pairs == 18 and all(v is not None for v in exposure.values()) and data['independentResponse']
    if data['status'] not in ('draft', 'submitted') or (data['status'] == 'submitted' and not complete):
        raise ValueError('incomplete response cannot be submitted')
    return {'valid': True, 'status': data['status'], 'completeItems': complete_items, 'completePairs': complete_pairs,
            'forTesting': data['forTesting'], 'unexposedSelfReport': all(v == 'no' for v in exposure.values()),
            'independenceVerified': False, 'contentApproved': False, 'preferenceAccuracyMeasured': False,
            'scope': 'response format/completeness only; exposure and disagreements remain separate'}


def build_pack(matrix, output):
    """외부 요청 없이 해시가 맞는 원본을 포함한 비공개 HTML을 만듭니다. 응답 파일은 덮어쓰지 않습니다."""
    manifest, mapping = make_manifest(matrix)
    output = output.resolve()
    private_root = (ROOT / 'data/private').resolve()
    if output == private_root or not output.is_relative_to(private_root) or output.exists():
        raise ValueError('new output directory under data/private required')
    images = {}
    inverse = {v: k for k, v in mapping['items'].items()}
    for row in matrix['items']:
        asset = (ROOT / row['assetPath']).resolve()
        raw = asset.read_bytes()
        if hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise ValueError('image hash mismatch: ' + row['id'])
        if raw.startswith(b'\x89PNG\r\n\x1a\n'):
            mime = 'image/png'
        elif raw.startswith(b'\xff\xd8'):
            mime = 'image/jpeg'
        else:
            raise ValueError('unsupported image type')
        images[inverse[row['id']]] = f'data:{mime};base64,' + base64.b64encode(raw).decode()
    html = (REVIEW / 'review-template.html').read_text(encoding='utf-8')
    output.mkdir(parents=True)
    for variant in manifest['variants']:
        value = {'manifest': manifest, 'variant': variant, 'response': template(manifest, variant), 'images': images}
        payload = json.dumps(value, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
        (output / (variant + '.html')).write_text(html.replace('__PACK_DATA__', payload), encoding='utf-8')
    (output / 'reviewer-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'packDigest': manifest['digest'], 'images': len(images), 'pairs': 18, 'variants': ['V1', 'V2'],
            'scope': 'private review preparation only; no collected human responses or approval'}


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    build = sub.add_parser('build'); build.add_argument('--output', type=Path, required=True)
    check = sub.add_parser('validate'); check.add_argument('response', type=Path); check.add_argument('--allow-test', action='store_true')
    args = parser.parse_args()
    matrix = json.loads((REVIEW / 'matrix.json').read_text(encoding='utf-8'))
    manifest, _ = make_manifest(matrix)
    if args.command == 'build':
        result = build_pack(matrix, args.output)
    else:
        if args.response.stat().st_size > 1024 * 1024:
            raise ValueError('response too large')
        result = validate_response(json.loads(args.response.read_text(encoding='utf-8-sig')), manifest, args.allow_test)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
