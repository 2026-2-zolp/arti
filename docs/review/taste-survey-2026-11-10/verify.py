# 검수 기준·익명 매핑·좌우 반전과 생성물의 정보 비노출을 확인합니다. 모델/DB/사람 검수를 실행하지 않습니다.
import base64
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from survey_blind_review import make_manifest, template, validate_response


def verify():
    matrix = json.loads((HERE / 'matrix.json').read_text(encoding='utf-8'))
    manifest, mapping = make_manifest(matrix)
    assert manifest == json.loads((HERE / 'reviewer-manifest.json').read_text(encoding='utf-8'))
    assert mapping == json.loads((HERE / 'manager-mapping.json').read_text(encoding='utf-8'))
    baseline = ROOT / 'docs/execution-plan/2026-11-07/records/W07-preparation/survey-comparison-2026-11-10'
    original = json.loads((baseline / 'protocol.json').read_text(encoding='utf-8'))
    refs = {x['id']: x for x in original['images']}
    assert all(row['sha256'] == refs[row['id']]['sha256'] and row['assetPath'] == refs[row['id']]['assetPath'] for row in matrix['items'])
    prior_pairs = {frozenset(ids[i:i+2]) for ids in original['pools'].values() for i in range(0, len(ids), 2)}
    assert len(prior_pairs) == 13
    assert {frozenset(x['items']) for x in matrix['pairs'][:13]} == prior_pairs
    table = (HERE / 'candidate-contrast-table.md').read_text(encoding='utf-8')
    assert all(x['id'] in table and x['title'] in table and x['sourceUrl'] in table for x in matrix['items'])
    assert all(x['id'] in table and x['confounds'] in table and x['sharedFeatures'] in table for x in matrix['pairs'])
    checked = 0
    folder = ROOT / 'data/private/survey-blind-review-20261110/pack-v2'
    if folder.is_dir():
        for variant in manifest['variants']:
            text = (folder / (variant + '.html')).read_text(encoding='utf-8')
            assert '__PACK_DATA__' not in text
            packed = json.loads(re.search(r'<script id="pack-data" type="application/json">(.*?)</script>', text, re.S)[1])
            assert packed['manifest'] == manifest and packed['response'] == template(manifest, variant)
            assert packed['variant'] == variant and set(packed['images']) == set(mapping['items'])
            for image in manifest['items']:
                raw = base64.b64decode(packed['images'][image['code']].split(',', 1)[1], validate=True)
                assert hashlib.sha256(raw).hexdigest() == image['sha256']
            for row in matrix['items']:
                assert row['id'] not in text and row['title'] not in text and row['assetPath'] not in text and row['sourceUrl'] not in text
            for pair in matrix['pairs']:
                assert pair['contrastHypothesis'] not in text
            assert 'connect-src &#39;none&#39;' in text or "connect-src 'none'" in text
            assert 'innerHTML' not in text and 'localStorage' not in text
            checked += 1
    for variant in manifest['variants']:
        response = template(manifest, variant)
        response.update(reviewerAlias='TEST_VERIFY', createdAt='2026-11-10T00:00:00+09:00', forTesting=True)
        result = validate_response(response, manifest, allow_test=True)
        assert result['completeItems'] == result['completePairs'] == 0
    result = {'ok': True, 'candidates': 21, 'pairs': 18, 'priorPairs': 13, 'newProposedPairs': 5,
              'privateHtmlVariantsChecked': checked, 'packDigest': manifest['digest'],
              'scope': 'review preparation; no human responses, model accuracy, selection or public activation'}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


if __name__ == '__main__':
    verify()
