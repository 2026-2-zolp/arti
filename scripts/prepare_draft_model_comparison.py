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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--product-revision', required=True, help='Full ARTI Git commit SHA')
    parser.add_argument('--review-template', action='store_true', help='Emit the blank X/Y scoring sheet without model IDs')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.product_revision):
        parser.error('Provide a full 40-character Git SHA.')
    try:
        plan = prepare(args.product_revision)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(review_template(plan) if args.review_template else plan, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
