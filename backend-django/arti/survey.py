# 전시 소속과 독립적인 취향 조사풀의 자격·버전·선택 근거를 검증합니다.
import hashlib
import json
from .constants import TAGS
from .http import ContractError
from .models import SurveyPool


def eligible(work):
    """관리자가 확정한 원문·태그와 표시 가능한 이미지가 있어야 합니다."""
    return (work.review_status == 'approved' and work.show_image
            and bool(work.image_file or work.image_url) and work.tag_status == 'confirmed'
            and isinstance(work.tags, list) and bool(work.tags)
            and all(isinstance(t, str) and t in TAGS for t in work.tags)
            and len(set(work.tags)) == len(work.tags))


def current_pool():
    """10점 전부 준비되어야 공개하며, 누락 작품을 임의 보충하지 않습니다."""
    pool = SurveyPool.objects.filter(active=True).first()
    if pool is None:
        return None, [], hashlib.sha256(b'no-active-survey').hexdigest()
    entries = list(pool.entries.select_related('artwork').order_by('position'))
    works = [e.artwork for e in entries]
    payload = [pool.id, pool.revision, [(e.position, w.id, w.exhibition_id, w.source_version,
                w.content_version, w.review_status, w.show_image, w.tag_status, w.tags,
                w.image_file, w.image_url) for e, w in zip(entries, works)]]
    version = hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    ready = [e.position for e in entries] == list(range(10)) and all(eligible(w) for w in works)
    return pool, works if ready else [], version


def selected_counts(profile, tastes):
    pool, works, version = current_pool()
    if len(works) != 10 or profile.get('poolVersion') != version:
        raise ContractError(409, 'VERSION_CONFLICT', '취향 조사 작품이 변경됐거나 준비 중이에요. 다시 확인해 주세요.')
    picks = profile.get('picks')
    if not isinstance(picks, list) or len(picks) != 5:
        raise ContractError(400, 'VALIDATION_ERROR', '다섯 쌍에서 한 작품씩 골라 주세요.')
    seen, counts = set(), {t: 0 for t in TAGS}
    for pick in picks:
        if not isinstance(pick, dict):
            raise ContractError(400, 'VALIDATION_ERROR', '선택 정보를 확인해 주세요.')
        index = pick.get('pairIndex')
        if type(index) is not int or not 0 <= index < 5 or index in seen:
            raise ContractError(400, 'VALIDATION_ERROR', '선택이 중복되거나 누락됐어요.')
        seen.add(index)
        work = next((w for w in works[index*2:index*2+2] if w.id == pick.get('artworkId')), None)
        if work is None:
            raise ContractError(400, 'VALIDATION_ERROR', '같은 쌍의 작품을 선택해 주세요.')
        for tag in work.tags:
            counts[tag] += 1
    if not tastes or any(counts.get(t, 0) == 0 for t in tastes):
        raise ContractError(400, 'VALIDATION_ERROR', '고른 작품에서 확인된 취향을 선택해 주세요.')
    return counts, pool
