"""Generate an offline, pinned comparison plan for A-04 text drafts."""
import argparse
import hashlib
import json
import re
from random import SystemRandom
from pathlib import Path


FIXTURES = Path(__file__).resolve().parents[1] / 'docs/review/docent-2026-11-15/luna-fixtures'
KANANA_REVISION = '6a5d7889964c4c590299d16e309eabab1f73f8a9'


def prepare(product_revision, folder=FIXTURES):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    trials = []
    for case in manifest['cases']:
        source = case['source']
        raw = (folder / source['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sha256']:
            raise ValueError(f'{case["id"]} source SHA-256 mismatch')
        for task in ('summary', 'guide'):
            for repeat in (1, 2):
                trials.append({
                    'id': f'{case["id"]}-{task}-{repeat}', 'caseId': case['id'], 'task': task, 'repeat': repeat,
                    'sourceVersion': source['version'], 'sourceSha256': source['sha256'],
                    'sourceFile': source['file'],
                })
    pairs = [('kanana', 'luna'), ('luna', 'kanana')] * (len(trials) // 2)
    SystemRandom().shuffle(pairs)
    for trial, models in zip(trials, pairs, strict=True):
        trial['labels'] = dict(zip(('X', 'Y'), models))
    return {
        'productRevision': product_revision, 'fixtureVersion': manifest['version'],
        'inputMode': 'text-only', 'state': 'planned',
        'models': {'kanana': {'name': 'kakaocorp/kanana-2-3b-instruct', 'revision': KANANA_REVISION},
                   'luna': {'name': 'gpt-6-luna', 'revision': None}},
        'trials': trials,
    }


def review_template(plan):
    return {
        'productRevision': plan['productRevision'], 'fixtureVersion': plan['fixtureVersion'],
        'inputMode': plan['inputMode'], 'reviewer': '',
        'reviews': [
            {**{key: trial[key] for key in ('id', 'caseId', 'task', 'sourceVersion', 'sourceSha256')},
             'label': label, 'draft': None, 'evidenceScore': None, 'taskScore': None,
             'evidenceNote': None, 'criticalError': None, 'verdict': 'pending'}
            for trial in plan['trials'] for label in ('X', 'Y')
        ],
    }


def validate_review(plan, sheet):
    revision_keys = ('productRevision', 'fixtureVersion', 'inputMode')
    if not isinstance(sheet, dict) or any(sheet.get(key) != plan[key] for key in revision_keys):
        raise ValueError('Review product revision or input mode does not match')
    expected = {(row['id'], row['label']): row for row in review_template(plan)['reviews']}
    remaining = set(expected)
    scores = {'pending': 0, 'usable': 0, 'revise': 0, 'failed': 0}
    if not isinstance(sheet.get('reviews'), list):
        raise ValueError('Review rows are missing')
    for row in sheet['reviews']:
        if (not isinstance(row, dict) or not isinstance(row.get('id'), str)
                or row.get('label') not in ('X', 'Y')):
            raise ValueError('Review row needs a trial ID and X/Y label')
        key = (row['id'], row['label'])
        if key not in remaining:
            raise ValueError(f'{key[0]} {key[1]} is unknown or duplicated')
        remaining.remove(key)
        if any(row.get(field) != expected[key][field] for field in ('caseId', 'task', 'sourceVersion', 'sourceSha256')):
            raise ValueError(f'{key[0]} {key[1]} input does not match')
        verdict = row.get('verdict')
        if verdict == 'pending':
            scores['pending'] += 1
            continue
        points = (row.get('evidenceScore'), row.get('taskScore'))
        critical = row.get('criticalError')
        note, draft = row.get('evidenceNote'), row.get('draft')
        has_draft = isinstance(draft, (str, dict)) and bool(draft)
        failed_without_draft = draft is None and critical is True and points == (0, 0)
        if (type(critical) is not bool or not all(type(point) is int and 0 <= point <= 2 for point in points)
                or not isinstance(note, str) or not note.strip() or not (has_draft or failed_without_draft)):
            raise ValueError(f'{key[0]} {key[1]} needs scores, a draft and evidence')
        expected_verdict = 'failed' if critical else 'usable' if sum(points) >= 3 else 'revise'
        if verdict != expected_verdict:
            raise ValueError(f'{key[0]} {key[1]} verdict should be {expected_verdict}')
        scores[expected_verdict] += 1
    if remaining:
        raise ValueError(f'Missing {len(remaining)} review rows')
    return scores


def summarize_review(reference, private_plan, sheet):
    if not isinstance(private_plan, dict) or any(private_plan.get(key) != reference[key] for key in (
            'productRevision', 'fixtureVersion', 'inputMode', 'models')):
        raise ValueError('Private plan revision, input or models do not match')
    expected = {row['id']: {key: value for key, value in row.items() if key != 'labels'} for row in reference['trials']}
    assignments = {}
    if not isinstance(private_plan.get('trials'), list):
        raise ValueError('Private plan trial rows are missing')
    for row in private_plan['trials']:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str):
            raise ValueError('Private plan trial needs an ID')
        identifier = row['id']
        fields = {key: value for key, value in row.items() if key != 'labels'}
        labels = row.get('labels')
        if (identifier in assignments or fields != expected.get(identifier) or not isinstance(labels, dict)
                or set(labels) != {'X', 'Y'} or sorted(str(value) for value in labels.values()) != ['kanana', 'luna']):
            raise ValueError(f'{identifier} has a duplicate or invalid private assignment')
        assignments[identifier] = labels
    if assignments.keys() != expected.keys():
        raise ValueError('Private plan does not contain all trials')

    validate_review(reference, sheet)
    counts = {model: {task: dict.fromkeys(('pending', 'usable', 'revise', 'failed', 'failedWithoutDraft'), 0)
                      for task in ('summary', 'guide')} for model in reference['models']}
    reviewed = {}
    for row in sheet['reviews']:
        identifier = row['id']
        result = counts[assignments[identifier][row['label']]][row['task']]
        result[row['verdict']] += 1
        if row['verdict'] == 'failed' and row.get('draft') is None:
            result['failedWithoutDraft'] += 1
        if row['verdict'] != 'pending':
            reviewed[identifier] = reviewed.get(identifier, 0) + 1
    return {'productRevision': reference['productRevision'], 'pairedReviews': sum(value == 2 for value in reviewed.values()),
            'totalPairs': len(expected), 'byModelAndTask': counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--product-revision', required=True, help='Full ARTI Git commit SHA')
    output = parser.add_mutually_exclusive_group()
    output.add_argument('--review-template', action='store_true', help='Emit the blank X/Y scoring sheet without model IDs')
    output.add_argument('--validate-review', type=Path, help='Validate a completed or partial X/Y scoring sheet')
    output.add_argument('--summarize-review', type=Path, help='Summarize reviewed trials by model with the original private plan')
    parser.add_argument('--private-plan', type=Path, help='Original saved X/Y mapping for --summarize-review')
    args = parser.parse_args()
    if bool(args.summarize_review) != bool(args.private_plan):
        parser.error('--summarize-review and --private-plan are required together.')
    if not re.fullmatch(r'[a-f0-9]{40}', args.product_revision):
        parser.error('Provide a full 40-character Git SHA.')
    try:
        plan = prepare(args.product_revision)
        if args.summarize_review:
            private_plan = json.loads(args.private_plan.read_text(encoding='utf-8-sig'))
            sheet = json.loads(args.summarize_review.read_text(encoding='utf-8-sig'))
            result = summarize_review(plan, private_plan, sheet)
        elif args.validate_review:
            result = validate_review(plan, json.loads(args.validate_review.read_text(encoding='utf-8-sig')))
        else:
            result = review_template(plan) if args.review_template else plan
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
