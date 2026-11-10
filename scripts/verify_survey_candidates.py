# 조사 후보의 파일 근거·쌍 구성·비공개 상태와 가설 분포를 읽기 전용으로 검증합니다.
import collections
import hashlib
import itertools
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT/'data/intake/2026-11-10-taste-survey'
TAGS = {'landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft'}


def verify():
    selection = json.loads((DIRECTORY/'selection.json').read_text(encoding='utf-8'))
    pool = json.loads((DIRECTORY/'pool-manifest.json').read_text(encoding='utf-8'))
    bundle = json.loads((DIRECTORY/'import-manifest.json').read_text(encoding='utf-8'))
    items, pairs = selection['items'], selection['pairs']
    assert selection['activate'] is False and selection['status'] == 'private_proposal_only'
    assert selection['selectionFinal'] is False
    assert len(items) == 10 and len({r['dbId'] for r in items}) == 10
    assert len({r['sha256'] for r in items}) == 10
    assert len(pairs) == 5 and [p['pairIndex'] for p in pairs] == list(range(5))
    ids = [r['dbId'] for r in items]
    assert pool['artworkIds'] == ids
    assert [pk for p in pairs for pk in (p['leftId'], p['rightId'])] == ids
    missing_private = []
    for row in items:
        assert row['humanReview'] == 'pending'
        assert row['tagStatus'] == 'selection_hypothesis_not_model_or_ground_truth'
        assert row['candidateTags'] and set(row['candidateTags']) <= TAGS
        path = (ROOT/row['assetPath']).resolve()
        assert path.is_relative_to(ROOT)
        if not path.is_file() and row['existingDbReference']:
            missing_private.append(row['dbId'])
            continue  # 새 체크아웃에는 기존 비공개 이미지가 없을 수 있습니다.
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
    new = [r for r in items if not r['existingDbReference']]
    assert len(new) == len(bundle['items']) == 9
    for row, imported in zip(new, bundle['items']):
        assert row['dbId'] == imported['id'] and row['sha256'] == imported['sha256']
        assert imported['identityStatus'] == 'candidate' and imported['rightsStatus'] == 'unverified'
        assert 'tags' not in imported and 'reviewStatus' not in imported
    coverage = collections.Counter(t for r in items for t in r['candidateTags'])
    assert set(coverage) == TAGS
    choices = []
    for bits in itertools.product((0, 1), repeat=5):
        counts = collections.Counter(t for i, side in enumerate(bits) for t in items[i*2+side]['candidateTags'])
        maximum = max(counts.values())
        choices.append({'bits': list(bits), 'tagCount': len(counts),
                        'topTieCount': sum(v == maximum for v in counts.values()), 'tags': sorted(counts)})
    always = sorted(set.intersection(*(set(r['tags']) for r in choices)))
    assert not always, '가설 수준에서도 모든 선택에서 강제로 발생하는 태그를 피합니다.'
    return {'ok': True, 'scope': 'selection hypotheses, not model/accuracy/human approval',
            'coverage': dict(coverage), 'alwaysPresentTags': always,
            'selectionCount': 32, 'tagCountDistribution': dict(collections.Counter(r['tagCount'] for r in choices)),
            'topTieSelections': sum(r['topTieCount'] > 1 for r in choices),
            'missingPrivateAssets': missing_private, 'choices': choices}


if __name__ == '__main__':
    print(json.dumps(verify(), ensure_ascii=False, indent=2))
