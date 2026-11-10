# 고정된 실제 점수·비교 범위·비공개 보존을 재검증합니다. 모델 재호출은 하지 않습니다.
import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(ROOT/'scripts'))
from survey_candidate_compare import read_protocol


def verify():
    protocol = read_protocol(HERE/'protocol.json', require_assets=False)
    for sub in ('initial', 'scoring-v2'):
        read_protocol(HERE/sub/'protocol.json', require_assets=False)
    raw = json.loads((HERE/'raw-model-scores.json').read_text(encoding='utf-8'))
    summary = json.loads((HERE/'summary.json').read_text(encoding='utf-8'))
    scoring = json.loads((HERE/'scoring-v2/protocol.json').read_text(encoding='utf-8'))
    assert raw['protocolSha256'] == hashlib.sha256(json.dumps(scoring, ensure_ascii=False, indent=2).encode()).hexdigest()
    assert len(protocol['images']) == len(raw['items']) == 54
    assert len({r['sha256'] for r in protocol['images']}) == 54
    assert raw['reusedItemCount'] == 49 and max(raw['repeats'].values()) <= .001
    tags = {'landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft'}
    for row in protocol['images']:
        values = raw['items'][row['id']]
        assert values['imageSha256'] == row['sha256']
        assert set(values['tags']) == set(values['tagsRaw']) == tags
        for scores in ('tags', 'tagsRaw', 'emotions', 'imageEmotions', 'textEmotions'):
            assert all(type(x) in (int, float) and math.isfinite(x) and 0 <= x <= 1 for x in values[scores].values())
    assert sorted(map(len, protocol['targets'].values())) == [8, 15, 18]
    for pool in protocol['pools'].values():
        assert len(pool) == len(set(pool)) == 10
        for target in protocol['targets'].values():
            assert not set(pool) & set(target)
    assert summary['selectionFinal'] is False and summary['approvalTransferred'] is False
    assert summary['recommendationExecutions'] == 3*32*4*3*3 == 3456
    assert summary['priorityControlParityChecks'] == 864
    for result in summary['poolResults'].values():
        assert sum(result['tagCounts'].values()) == 32
        assert len(result['strategyStats']) == 4
        for strategy in result['strategyStats'].values():
            assert 0 <= strategy['blocked'] <= 32
            for metrics in strategy['targets'].values():
                assert metrics['zeroMatchSlots'] <= metrics['totalSlots']
    private = ROOT/'data/private/survey-comparison-20261110'
    state_checked = False
    if (private/'before-state.json').is_file() and (private/'after-state.json').is_file():
        before = json.loads((private/'before-state.json').read_text())
        after = json.loads((private/'after-state.json').read_text())
        assert before == after and after['activeSurveys'] == 0
        state_checked = True
    result = {'ok': True, 'images': 54, 'recommendationScenarios': 3456,
              'targetSizes': summary['targetCorpora'], 'privateStateRechecked': state_checked,
              'scope': 'stored inference/structural comparison checks; not independent human accuracy, final selection or publication'}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


if __name__ == '__main__':
    verify()
