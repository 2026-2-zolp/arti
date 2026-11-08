# 취향 점수로 작품을 선정하고 좌표상 가까운 방문 순서를 계산합니다.
import hashlib
import json
import math
from .constants import DURATION_COUNTS, LABELS, TAGS
from .http import ContractError


def strength(work, tag):
    if work.tag_status == 'confirmed' and isinstance(work.tag_scores, dict):
        value = work.tag_scores.get(tag, 0)
        return value if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1 else 0
    return 1 if tag in work.tags else 0


def make_pool(works):
    ready = sorted([w for w in works if w.show_image and (w.image_file or w.image_url) and w.tags], key=lambda w: w.id)[:10]
    version = hashlib.sha256(json.dumps([(w.id, w.source_version, w.content_version, w.tags, w.image_file, w.image_url) for w in ready], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return ready, version


def weights_for(tastes, profile, works, account=None):
    counts = {t: 0 for t in TAGS}
    if profile is not None:
        if profile.get('version') != 1 or profile.get('source') not in ('picks', 'manual', 'saved'):
            raise ContractError(400, 'VALIDATION_ERROR', '취향 프로필 형식을 확인해 주세요.')
        selected = profile.get('selectedTags')
        if not isinstance(selected, list) or len(set(selected)) != len(selected) or set(selected) != set(tastes):
            raise ContractError(400, 'VALIDATION_ERROR', '취향 태그와 프로필이 일치하지 않아요.')
        source = profile['source']
        if source == 'saved':
            # W04 has no member-login/write flow: never trust client-supplied saved counts.
            if account is None or account.role != 'user':
                raise ContractError(401, 'AUTH_REQUIRED', '저장된 취향은 로그인 후 이용해 주세요.')
            if profile.get('savedProfileVersion') != account.taste_profile_version:
                raise ContractError(409, 'VERSION_CONFLICT', '저장된 취향이 변경됐어요.')
            if set(account.tastes) != set(tastes):
                raise ContractError(400, 'VALIDATION_ERROR', '저장된 취향과 요청이 일치하지 않아요.')
            counts = (account.taste_profile or {}).get('counts', counts)
        elif source == 'picks':
            pool, version = make_pool(works)
            if profile.get('poolVersion') != version:
                raise ContractError(409, 'VERSION_CONFLICT', '선택 작품이 변경됐어요. 다시 확인해 주세요.')
            picks = profile.get('picks')
            if len(pool) != 10 or not isinstance(picks, list) or len(picks) != 5:
                raise ContractError(400, 'VALIDATION_ERROR', '다섯 쌍에서 한 작품씩 골라 주세요.')
            seen = set()
            for pick in picks:
                if not isinstance(pick, dict):
                    raise ContractError(400, 'VALIDATION_ERROR', '선택 정보를 확인해 주세요.')
                index = pick.get('pairIndex')
                if type(index) is not int or not 0 <= index < 5 or index in seen:
                    raise ContractError(400, 'VALIDATION_ERROR', '선택이 중복되거나 누락됐어요.')
                seen.add(index)
                match = next((w for w in pool[index*2:index*2+2] if w.id == pick.get('artworkId')), None)
                if match is None:
                    raise ContractError(400, 'VALIDATION_ERROR', '같은 쌍의 작품을 선택해 주세요.')
                for tag in match.tags:
                    counts[tag] += 1
        elif profile.get('picks') not in ([], None) or profile.get('poolVersion') is not None:
            raise ContractError(400, 'VALIDATION_ERROR', '수동 취향에 선택 이력을 넣을 수 없어요.')
    raw = {t: max(1, counts.get(t, 0)) for t in tastes}
    total = sum(raw.values())
    return {t: raw[t] / total for t in tastes} if total else {}


def profile_snapshot(tastes, profile, works, account=None, exhibition_id=None):
    from .serializers import TasteProfileInput
    if not isinstance(tastes, list) or any(t not in TAGS for t in tastes) or len(set(tastes)) != len(tastes):
        raise ContractError(400, 'VALIDATION_ERROR', '취향 태그를 확인해 주세요.')
    if profile is not None:
        form = TasteProfileInput(data=profile)
        form.is_valid(raise_exception=True)
        profile = form.validated_data
    weights_for(tastes, profile, works, account)
    if profile and profile['source'] == 'saved':
        return account.taste_profile or {'version': 1, 'source': 'manual', 'picks': [], 'poolVersion': None,
                                        'counts': {t: 0 for t in TAGS}, 'selectedTags': tastes}
    counts = {t: 0 for t in TAGS}
    if profile and profile['source'] == 'picks':
        pool, _ = make_pool(works)
        for pick in profile['picks']:
            w = next(w for w in pool if w.id == pick['artworkId'])
            for t in w.tags:
                counts[t] += 1
        return {**profile, 'counts': counts, 'originExhibitionId': exhibition_id,
                'originalPoolVersion': profile['poolVersion'], 'originalPicks': profile['picks']}
    return {'version': 1, 'source': 'manual', 'picks': [], 'poolVersion': None,
            'counts': counts, 'selectedTags': tastes}


def recommend(works, exhibition, tastes, duration, profile=None, account=None):
    ordered_tags = [t for t in TAGS if t in tastes]
    weights = weights_for(ordered_tags, profile, works, account)
    candidates = [w for w in works if w.position_x is not None]
    scored = [(w, sum(weights[t]*strength(w, t) for t in ordered_tags)) for w in candidates]
    ranked = sorted(scored, key=lambda item: (-item[1], item[0].id))
    count = DURATION_COUNTS[duration]
    picked = []
    for tag in sorted(ordered_tags, key=lambda t: (-weights[t], TAGS.index(t)))[:count]:
        best = next((v for v in ranked if strength(v[0], tag) >= .5 and v not in picked), None)
        if best:
            picked.append(best)
    for item in ranked:
        if len(picked) >= count:
            break
        if item not in picked:
            picked.append(item)
    result = []
    x, y = exhibition.entrance_x, exhibition.entrance_y
    while picked:
        # Stable score/ID order resolves equal distances.
        index = min(range(len(picked)), key=lambda i: math.hypot(picked[i][0].position_x-x, picked[i][0].position_y-y))
        work, score = picked.pop(index)
        x, y = work.position_x, work.position_y
        by_strength = sorted(ordered_tags, key=lambda t: (-strength(work, t), TAGS.index(t)))
        matched = [t for t in by_strength if strength(work, t) >= .5]
        result.append({'artworkId': work.id, 'order': len(result)+1, 'score': round(score+1e-12, 3),
                       'matchedTags': matched, 'matchedCard': by_strength[0] if by_strength and strength(work, by_strength[0]) > 0 else None,
                       'aiTags': work.tag_status == 'confirmed' and work.tag_scores is not None,
                       'reason': ' · '.join(LABELS[t] for t in matched) if matched else '새로운 취향을 넓혀 줄 작품'})
    return result
