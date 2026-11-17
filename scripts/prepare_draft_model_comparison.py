"""Generate an offline, pinned comparison plan for A-04 text drafts."""
import argparse
import hashlib
import json
import re
from pathlib import Path


FIXTURES = Path(__file__).resolve().parents[1] / 'docs/review/docent-2026-11-15/luna-fixtures'
KANANA_REVISION = '6a5d7889964c4c590299d16e309eabab1f73f8a9'


def prepare(product_revision, folder=FIXTURES):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    trials = []
    for case_index, case in enumerate(manifest['cases']):
        source = case['source']
        raw = (folder / source['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sha256']:
            raise ValueError(f'{case["id"]} source SHA-256 mismatch')
        for task_index, task in enumerate(('summary', 'guide')):
            for repeat in (1, 2):
                names = ('kanana', 'luna') if (case_index + task_index + repeat) % 2 else ('luna', 'kanana')
                trials.append({
                    'id': f'{case["id"]}-{task}-{repeat}', 'caseId': case['id'], 'task': task, 'repeat': repeat,
                    'sourceVersion': source['version'], 'sourceSha256': source['sha256'],
                    'sourceFile': source['file'], 'labels': dict(zip(('X', 'Y'), names)),
                })
    return {
        'productRevision': product_revision, 'fixtureVersion': manifest['version'],
        'inputMode': 'text-only', 'state': 'planned',
        'models': {'kanana': {'name': 'kakaocorp/kanana-2-3b-instruct', 'revision': KANANA_REVISION},
                   'luna': {'name': 'gpt-6-luna', 'revision': None}},
        'trials': trials,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--product-revision', required=True, help='Full ARTI Git commit SHA')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.product_revision):
        parser.error('Provide a full 40-character Git SHA.')
    try:
        plan = prepare(args.product_revision)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(plan, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
