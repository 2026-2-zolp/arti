# 핵심 3점 회신에서 현행 도판·문안에 연결할 수 있는 행을 확인합니다.
import argparse
import hashlib
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'data/intake/2026-11-09-yoo-youngkuk/core3-manifest.json'
WORDING = ROOT / 'docs/operations/2026-11-13_W06_핵심3점_콘텐츠재검수.md'
FIELDS = ('description', 'summary', 'question', 'hint')
MEDIA = ('campus_demo', 'presentation', 'recording', 'external_url')
DECISIONS = ('confirmed', 'revise', 'hold')


def read_references():
    items = json.loads(MANIFEST.read_text(encoding='utf-8'))['items']
    hashes = {item['recordId']: item['sha256'] for item in items}
    wording_hash = hashlib.sha256(WORDING.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    return hashes, wording_hash


def compare_hash(received, expected, name):
    if not has_text(received):
        return f'{name}-missing'
    if received.strip().lower() != expected.lower():
        return f'{name}-mismatch'
    return None


def has_text(value):
    return isinstance(value, str) and bool(value.strip())


def valid_date(value):
    try:
        return date.fromisoformat(value).isoformat() == value
    except (TypeError, ValueError):
        return False


def check_rows(rows, key, expected, binding_issues, evidence_fields):
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError(f'{key} entries must be a list of objects')

    by_name = {name: [] for name in expected}
    unassigned = []
    for index, row in enumerate(rows, start=1):
        name = row.get(key)
        if name in expected:
            by_name[name].append((index, row))
        else:
            unassigned.append(index)

    results = {}
    for name, matches in by_name.items():
        if len(matches) != 1:
            reason = 'multiple-entries' if matches else 'no-entry'
            results[name] = {'status': 'pending', 'issues': [*binding_issues, reason]}
            if matches:
                results[name]['entries'] = [index for index, _ in matches]
            continue

        index, row = matches[0]
        issues = list(binding_issues)
        issues.extend(f'{field}-missing' for field in ('reviewer', *evidence_fields) if not has_text(row.get(field)))
        if not valid_date(row.get('reviewedOn')):
            issues.append('reviewedOn-required')
        if row.get('decision') not in DECISIONS:
            issues.append('decision-required')
        if row.get('decision') == 'hold':
            issues.append('reviewer-hold')

        results[name] = {
            'status': 'pending' if issues else 'recordable',
            'issues': issues,
            'entry': index,
            **{field: row[field] for field in ('reviewer', 'reviewedOn', 'decision') if field in row},
        }
    return results, unassigned


def confirmed(row):
    return row['status'] == 'recordable' and row.get('decision') == 'confirmed'


def check_receipt(receipt, expected_hashes, expected_wording_hash):
    if not isinstance(receipt, dict):
        raise ValueError('receipt must be an object')
    record_id = receipt.get('recordId')
    if not isinstance(record_id, str) or record_id not in expected_hashes:
        raise ValueError('unknown core3 recordId')

    image_issue = compare_hash(receipt.get('imageSha256'), expected_hashes[record_id], 'imageSha256')
    wording_issue = compare_hash(receipt.get('wordingSha256'), expected_wording_hash, 'wordingSha256')
    content, unassigned_content = check_rows(
        receipt.get('content', []), 'field', FIELDS,
        [issue for issue in (image_issue, wording_issue) if issue], ('judgedText', 'evidence'),
    )
    usage, unassigned_usage = check_rows(
        receipt.get('usage', []), 'medium', MEDIA,
        [image_issue] if image_issue else [], ('evidence', 'scope'),
    )
    pending_content_fields = [field for field, row in content.items() if not confirmed(row)]
    media_handoff = {}
    for medium, row in usage.items():
        usage_confirmed = confirmed(row)
        media_handoff[medium] = {
            'usageConfirmed': usage_confirmed,
            'status': 'ready-for-review' if usage_confirmed and not pending_content_fields else 'pending',
        }
    return {
        'recordId': record_id,
        'content': content,
        'usage': usage,
        'unassignedContentEntries': unassigned_content,
        'unassignedUsageEntries': unassigned_usage,
        'handoff': {'pendingContentFields': pending_content_fields, 'media': media_handoff},
        'scope': 'receipt precheck only',
    }


def main():
    parser = argparse.ArgumentParser(description='핵심 3점 회신의 도판·문안 연결을 사전 확인합니다.')
    parser.add_argument('receipt', type=Path)
    args = parser.parse_args()
    try:
        receipt = json.loads(args.receipt.read_text(encoding='utf-8-sig'))
        result = check_receipt(receipt, *read_references())
    except (OSError, ValueError) as error:
        parser.exit(2, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
