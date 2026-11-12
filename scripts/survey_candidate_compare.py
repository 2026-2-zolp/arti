# 비공개 조사 후보를 실제 고정 모델로 분석하고 메모리에서 추천 변화만 비교합니다.
import argparse
import collections
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import statistics
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def read_protocol(path, require_assets=True):
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == path.with_name('protocol.sha256').read_text().strip()
    value = json.loads(raw)
    for name, expected in value['sourceHashes'].items():
        assert hashlib.sha256((ROOT/name).read_text(encoding='utf-8').encode()).hexdigest() == expected, name
    for row in value['images']:
        path = (ROOT/row['assetPath']).resolve()
        assert path.is_relative_to(ROOT), row['id']
        if require_assets:
            assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], row['id']
    return value


def dump(path, value):
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())


def infer(protocol, output, reuse_raw=None, reuse_protocol=None):
    assert not output.exists(), 'Frozen model output cannot be overwritten.'
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_IMPLICIT_TOKEN='1',
                     ARTI_WRITER_ENABLED='false', ARTI_PRELOAD='false', OMP_NUM_THREADS='4', MKL_NUM_THREADS='4')
    sys.path.insert(0, str(ROOT/'ai-service'))
    from app.analyzer import HuggingFaceScorer, analyze, load_calibration, load_tag_thresholds
    from app import config
    from app.tags import TAG_KEYS
    from PIL import Image
    import torch
    torch.set_num_threads(4)
    torch.manual_seed(0)
    assert config.IMAGE_WEIGHT == protocol['inference']['imageWeight']
    reused = json.loads(reuse_raw.read_text(encoding='utf-8')) if reuse_raw else None
    if reused:
        assert reuse_protocol
        parent = read_protocol(reuse_protocol)
        assert parent['sourceHashes'] == protocol['sourceHashes'] and parent['inference'] == protocol['inference']
        assert reused['protocolSha256'] == hashlib.sha256(json.dumps(parent, ensure_ascii=False, indent=2).encode()).hexdigest()
        current = {r['id']: r for r in protocol['images']}
        assert all(current[r['id']] == r for r in parent['images'])
        expected = {r['id']: r['sha256'] for r in protocol['images']}
        assert all(expected.get(k) == r['imageSha256'] for k, r in reused['items'].items())
    scorer = HuggingFaceScorer(str(ROOT/protocol['inference']['clipPath']), str(ROOT/protocol['inference']['nliPath']))
    start = time.perf_counter()
    scorer.load()
    result = {'loadSeconds': time.perf_counter()-start, 'items': dict(reused['items']) if reused else {}, 'repeats': {},
              'protocolSha256': hashlib.sha256(json.dumps(protocol, ensure_ascii=False, indent=2).encode()).hexdigest(),
              'scope': 'private image/NLI inference; no approval, database or GPT calls'}
    import importlib.metadata
    result['versions'] = {name: importlib.metadata.version(name) for name in ('torch', 'transformers', 'Pillow')}
    if reused:
        result['reusedRawSha256'] = hashlib.sha256(reuse_raw.read_bytes()).hexdigest()
        result['reusedItemCount'] = len(reused['items'])
    pending = [r for r in protocol['images'] if r['id'] not in result['items']]
    for index, row in enumerate(pending):
        start = time.perf_counter()
        with Image.open(ROOT/row['assetPath']) as image:
            size = list(image.size)
            value = analyze(scorer, row['caption'], image.convert('RGB'),
                            calibration=load_calibration(), tag_thresholds=load_tag_thresholds())
        assert set(value.tags) == set(TAG_KEYS) == set(value.tags_raw)
        for scores in (value.tags, value.tags_raw, value.emotions, value.image_scores, value.text_scores):
            assert scores and all(math.isfinite(v) and 0 <= v <= 1 for v in scores.values())
        result['items'][row['id']] = {'imageSha256': row['sha256'], 'inputSize': size,
            'tagsRaw': value.tags_raw, 'tags': value.tags, 'emotions': value.emotions,
            'imageEmotions': value.image_scores, 'textEmotions': value.text_scores,
            'seconds': time.perf_counter()-start}
        if (index+1) % 5 == 0:
            print(f'inferred {index+1}/{len(pending)} new images', flush=True)
    for key in list(result['items'])[:3]:
        row = next(r for r in protocol['images'] if r['id'] == key)
        with Image.open(ROOT/row['assetPath']) as image:
            scores = scorer.image_tag_scores(image.convert('RGB'))
        delta = max(abs(scores[k]-result['items'][key]['tagsRaw'][k]) for k in TAG_KEYS)
        result['repeats'][key] = delta
        assert delta <= .001
    result['modelFileHashes'] = {}
    for folder in ('clipPath', 'nliPath'):
        for path in sorted((ROOT/protocol['inference'][folder]).iterdir()):
            if path.is_file() and path.suffix in ('.bin', '.safetensors', '.json'):
                result['modelFileHashes'][folder+'/'+path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if reused:
        assert result['modelFileHashes'] == reused['modelFileHashes']
    dump(output, result)


def preference(bits, ids, rows, tags, strategy):
    chosen = [ids[i*2+side] for i, side in enumerate(bits)]
    counts = collections.Counter(t for key in chosen for t in tags if rows[key]['tags'][t] >= .5)
    selected = [t for t in tags if counts[t] > 0]
    if strategy in ('current_all_frequency', 'all_frequency_ai_coverage_tiebreak'):
        return selected, dict(counts), None
    ai_sum = {t: sum(rows[key]['tags'][t] for key in chosen) for t in tags}
    if strategy == 'top3_frequency_then_ai_sum':
        selected = sorted(selected, key=lambda t: (-counts[t], -ai_sum[t], tags.index(t)))[:3]
        return selected, dict(counts), None
    if strategy != 'top3_signed_opponent_contrast':
        raise ValueError('Unknown comparison strategy: '+strategy)
    delta = {t: sum(rows[ids[i*2+side]]['tags'][t]-rows[ids[i*2+1-side]]['tags'][t]
                    for i, side in enumerate(bits)) for t in tags}
    selected = sorted([t for t in tags if delta[t] > 1e-9], key=lambda t: (-delta[t], tags.index(t)))[:3]
    total = sum(delta[t] for t in selected)
    return selected, dict(counts), {t: delta[t]/total for t in selected} if total else {}


def recommendation_priority_probe(works, ex, tastes, weights, count, priority):
    """빈도·선정 수를 유지하고 동점 우선순위만 바꾸는 메모리 대조군입니다."""
    scored = [(w, sum(weights[t]*w.tag_scores[t] for t in tastes)) for w in works]
    ranked = sorted(scored, key=lambda item: (-item[1], item[0].id))
    picked = []
    for tag in sorted(tastes, key=lambda t: (-weights[t], priority.index(t)))[:count]:
        best = next((v for v in ranked if v[0].tag_scores[tag] >= .5 and v not in picked), None)
        if best:
            picked.append(best)
    for item in ranked:
        if len(picked) >= count:
            break
        if item not in picked:
            picked.append(item)
    result = []
    x, y = ex.entrance_x, ex.entrance_y
    while picked:
        index = min(range(len(picked)), key=lambda i: math.hypot(picked[i][0].position_x-x, picked[i][0].position_y-y))
        work, score = picked.pop(index)
        x, y = work.position_x, work.position_y
        result.append({'artworkId': work.id, 'score': round(score+1e-12, 3),
                       'matchedTags': [t for t in tastes if work.tag_scores[t] >= .5]})
    return result


def summarize(protocol, result, output):
    os.environ.setdefault('DJANGO_SECRET_KEY', 'private-comparison-not-a-server-secret-more-than32')
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    os.environ.setdefault('ARTI_LLM_PROVIDER', 'disabled')
    sys.path.insert(0, str(ROOT/'backend-django'))
    import django
    django.setup()
    import arti.recommendations as engine
    from arti.constants import TAGS, DURATION_COUNTS
    assert set(result['items']) == {r['id'] for r in protocol['images']}
    assert all(result['items'][r['id']]['imageSha256'] == r['sha256'] for r in protocol['images'])
    rows = result['items']
    summary = {'scope': 'scenario sensitivity, not preference accuracy or user effectiveness',
               'imageCount': len(rows), 'poolResults': {}, 'strategyChanges': {}, 'examples': [],
               'targetCorpora': {k: len(v) for k, v in protocol['targets'].items()}, 'dbQueries': 0}
    scenarios = []
    for name, ids in protocol['pools'].items():
        assert len(set(ids)) == 10
        stats = {'tagCounts': collections.Counter(), 'topFrequencyTies': 0, 'thirdBoundaryTies': 0,
                 'forcedTags': None, 'strategyStats': {}}
        scenario_rows = []
        for bits in itertools.product((0, 1), repeat=5):
            selected, counts, _ = preference(bits, ids, rows, TAGS, 'current_all_frequency')
            stats['tagCounts'][len(selected)] += 1
            stats['forcedTags'] = set(selected) if stats['forcedTags'] is None else stats['forcedTags'] & set(selected)
            values = sorted([counts[t] for t in selected], reverse=True)
            stats['topFrequencyTies'] += bool(values and values.count(values[0]) > 1)
            stats['thirdBoundaryTies'] += bool(len(values) > 3 and values[2] == values[3])
            for strategy in protocol['strategies']:
                tastes, counts, override = preference(bits, ids, rows, TAGS, strategy)
                key = {'pool': name, 'bits': list(bits), 'strategy': strategy}
                entry = {**key, 'tastes': tastes, 'counts': counts, 'outputs': {}}
                account = SimpleNamespace(role='user', tastes=tastes, taste_profile_version=1, taste_profile={'counts': counts})
                profile = {'version': 1, 'source': 'saved', 'savedProfileVersion': 1, 'selectedTags': tastes}
                if not tastes:
                    entry['blocked'] = 'no_positive_taste'
                else:
                    for corpus, target_ids in protocol['targets'].items():
                        assert not set(ids) & set(target_ids)
                        works = [SimpleNamespace(id=pk, tags=[t for t in TAGS if rows[pk]['tags'][t] >= .5],
                            tag_status='confirmed', tag_scores=rows[pk]['tags'],
                            position_x=protocol['positions'][pk][0], position_y=protocol['positions'][pk][1]) for pk in target_ids]
                        ex = SimpleNamespace(entrance_x=protocol['entrance'][0], entrance_y=protocol['entrance'][1])
                        for duration in protocol['durations']:
                            # 확정 표시는 기존 순수 추천 함수의 메모리 어댑터일 뿐 DB 승인과 무관합니다.
                            if strategy == 'all_frequency_ai_coverage_tiebreak':
                                weights = engine.weights_for(tastes, profile, works, account)
                                ordered = [t for t in TAGS if t in tastes]
                                control = recommendation_priority_probe(works, ex, ordered, weights, DURATION_COUNTS[duration], list(TAGS))
                                baseline = engine.recommend(works, ex, tastes, duration, profile, account)
                                assert [(r['artworkId'], r['score'], sorted(r['matchedTags'])) for r in control] == [(r['artworkId'], r['score'], sorted(r['matchedTags'])) for r in baseline]
                                chosen = [ids[i*2+side] for i, side in enumerate(bits)]
                                priority = sorted(TAGS, key=lambda t: (-sum(rows[pk]['tags'][t] for pk in chosen), TAGS.index(t)))
                                recs = recommendation_priority_probe(works, ex, ordered, weights, DURATION_COUNTS[duration], priority)
                            elif override is None:
                                recs = engine.recommend(works, ex, tastes, duration, profile, account)
                            else:
                                # 가상 대비 가중치 주입은 입력 검증/공개 API 시험이 아닌 수학적 민감도 비교입니다.
                                with patch.object(engine, 'weights_for', return_value=override):
                                    recs = engine.recommend(works, ex, tastes, duration, profile, account)
                            assert len({r['artworkId'] for r in recs}) == len(recs)
                            assert all(r['artworkId'] in target_ids for r in recs)
                            entry['outputs'][corpus+'/'+duration] = {
                                'ids': [r['artworkId'] for r in recs],
                                'zeroMatch': sum(not r['matchedTags'] for r in recs),
                                'meanScore': statistics.mean(r['score'] for r in recs) if recs else None}
                scenario_rows.append(entry)
        stats['tagCounts'] = dict(stats['tagCounts'])
        stats['forcedTags'] = sorted(stats['forcedTags'])
        for strategy in protocol['strategies']:
            group = [r for r in scenario_rows if r['strategy'] == strategy]
            stats['strategyStats'][strategy] = {'blocked': sum('blocked' in r for r in group), 'targets': {}}
            for corpus in protocol['targets']:
                for duration in protocol['durations']:
                    key = corpus+'/'+duration
                    outputs = [r['outputs'][key] for r in group if key in r['outputs']]
                    stats['strategyStats'][strategy]['targets'][key] = {
                        'uniqueSets': len({tuple(sorted(r['ids'])) for r in outputs}),
                        'uniqueOrders': len({tuple(r['ids']) for r in outputs}),
                        'zeroMatchSlots': sum(r['zeroMatch'] for r in outputs),
                        'totalSlots': sum(len(r['ids']) for r in outputs)}
        for strategy in protocol['strategies'][1:]:
            base = [r for r in scenario_rows if r['strategy'] == protocol['strategies'][0]]
            alternate = [r for r in scenario_rows if r['strategy'] == strategy]
            changes = {}
            for corpus in protocol['targets']:
                for duration in protocol['durations']:
                    key = corpus+'/'+duration
                    common = [(a['outputs'][key], b['outputs'][key]) for a, b in zip(base, alternate)
                              if key in a['outputs'] and key in b['outputs']]
                    changes[key] = {'comparableScenarios': len(common),
                        'changedSets': sum(set(a['ids']) != set(b['ids']) for a, b in common),
                        'changedOrders': sum(a['ids'] != b['ids'] for a, b in common)}
            summary['strategyChanges'][name+'/'+strategy] = changes
        summary['poolResults'][name] = stats
        scenarios.extend(scenario_rows)
    # 비교표에는 실제 모델 결과 일부를 예시로 두고 전체 경로는 로컬에 보존합니다.
    summary['examples'] = [r for r in scenarios if r['bits'] in ([0,0,0,0,0], [1,1,1,1,1])]
    summary['rawInferenceSeconds'] = sum(r['seconds'] for r in rows.values())
    summary['repeatMaxDelta'] = max(result['repeats'].values())
    dump(output, summary)
    return scenarios


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--summary', type=Path)
    parser.add_argument('--scenarios', type=Path)
    parser.add_argument('--infer', action='store_true')
    parser.add_argument('--reuse-raw', type=Path)
    parser.add_argument('--reuse-protocol', type=Path)
    args = parser.parse_args()
    # 재추론은 원본 파일을 모두 검사합니다. 점수 재생은 Git의 고정 점수/입력 해시로 가능합니다.
    protocol = read_protocol(args.protocol, require_assets=args.infer)
    if args.infer:
        infer(protocol, args.raw, args.reuse_raw, args.reuse_protocol)
    if args.summary:
        assert args.scenarios
        # 실제 DB 커서 접근은 즉시 실패시켜 비공개 메모리 비교의 경계를 검증합니다.
        with patch('django.db.backends.base.base.BaseDatabaseWrapper.cursor', side_effect=AssertionError('Database access forbidden in offline comparison')):
            scenarios = summarize(protocol, json.loads(args.raw.read_text(encoding='utf-8')), args.summary)
        dump(args.scenarios, scenarios)


if __name__ == '__main__':
    main()
