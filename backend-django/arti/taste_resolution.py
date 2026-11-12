# 취향 조사와 저장된 프로필에서 서버가 사용할 태그 우선순위를 계산합니다.
import logging
import math
import re
from contextlib import contextmanager
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import OperationalError, connection, transaction

from .constants import TAGS
from .http import ContractError
from .model_service import evidence_digest
from .models import Account, Session
from .survey import current_pool, selected_counts
from .tag_scores import current_evidence

POLICY = 'frequency-ai-tie-v1'
DEFINITION = 'arti-eight-tags-v1'
logger = logging.getLogger(__name__)


def invalid(message='취향 프로필을 확인해 주세요.'):
    raise ContractError(400, 'VALIDATION_ERROR', message)


def conflict():
    raise ContractError(409, 'VERSION_CONFLICT', '취향 근거 또는 저장된 취향이 변경됐어요. 다시 확인해 주세요.')


def require_enabled():
    if not settings.ARTI_TASTE_PROFILE_V2_ENABLED:
        raise ContractError(503, 'FEATURE_DISABLED', '새 취향 확인은 지금 이용할 수 없어요.')


@contextmanager
def taste_transaction():
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '2s'")
            yield
    except OperationalError as exc:
        if getattr(exc.__cause__, 'sqlstate', None) == '55P03':
            raise ContractError(503, 'TEMPORARY_UNAVAILABLE', '다른 변경이 진행 중이에요. 같은 입력으로 다시 시도해 주세요.', retryable=True) from None
        raise


def locked_actor(request):
    if not request.user:
        if getattr(request, 'provided_token', False):
            raise ContractError(401, 'SESSION_EXPIRED', '다시 로그인해 주세요.')
        return None
    from django.utils import timezone

    account = Account.objects.select_for_update().filter(pk=request.user.pk, role='user', status='active').first()
    if account is None or not Session.objects.filter(pk=request.auth.pk, account=account, expires_at__gt=timezone.now()).exists():
        raise ContractError(401, 'SESSION_EXPIRED', '다시 로그인해 주세요.')
    return account


def score_units(value):
    if type(value) not in (int, float) or not 0 <= value <= 1 or not math.isfinite(value):
        return None
    return int((Decimal(str(value)) * 1_000_000).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def score_row(work):
    evidence = current_evidence(work) or {}
    scores = work.tag_scores if isinstance(work.tag_scores, dict) else {}
    return {
        'id': work.id,
        'tagStatus': work.tag_status,
        'signature': evidence.get('signatureSha256'),
        'tagSource': evidence.get('tagSource'),
        'scoreRevision': work.tag_score_revision,
        'imageSha256': evidence.get('imageSha256'),
        'tags': [tag for tag in TAGS if tag in work.tags],
        'scoresUnits': {tag: score_units(scores.get(tag)) for tag in TAGS},
    }


def pool_context(works, pool_version):
    approved = settings.ARTI_TASTE_APPROVED_SIGNATURE_SHA256
    approved = approved if re.fullmatch(r'[0-9a-f]{64}', approved) else None
    rows = [score_row(work) for work in works]
    version = evidence_digest({
        'policyVersion': POLICY, 'tagDefinitionVersion': DEFINITION,
        'poolVersion': pool_version, 'approvedSignature': approved, 'orderedPoolRows': rows,
    })
    return rows, approved, version


def comparable_totals(tags, rows, approved):
    if not approved:
        return None, 'unverified_signature'
    if any(row['signature'] != approved or row['tagSource'] != 'image' for row in rows):
        return None, 'incomparable_source'
    if any(type(row['scoreRevision']) is not int or row['scoreRevision'] < 1
           or not re.fullmatch(r'[0-9a-f]{64}', row['imageSha256'] or '') for row in rows):
        return None, 'unverified_score_input'
    if any(row['scoresUnits'].get(tag) is None for row in rows for tag in tags):
        return None, 'missing_or_invalid_score'
    return {tag: sum(row['scoresUnits'][tag] for row in rows) for tag in tags}, 'complete_comparable_scores'


def binding(counts, tags):
    return evidence_digest({'counts': counts, 'selectedTags': sorted(tags)})


def groups_for(counts, tags, *, rows=None, approved=None, frozen=None):
    groups = []
    weights = {tag: max(1, counts[tag]) for tag in tags}
    for weight in sorted(set(weights.values()), reverse=True):
        group = [tag for tag in TAGS if weights.get(tag) == weight]
        totals = None
        rule, reason = 'canonical_fallback', 'legacy_or_manual_without_frozen_tie'
        if len(group) == 1:
            rule, reason = 'frequency', 'no_tie'
        elif frozen is not None:
            group = [tag for tag in frozen if tag in group]
            rule, reason = 'frozen_snapshot', 'no_current_pool_or_model_lookup'
        elif rows is not None:
            totals, reason = comparable_totals(group, rows, approved)
            if totals is not None:
                group.sort(key=lambda tag: (-totals[tag], TAGS.index(tag)))
                rule = 'ai_secondary'
        groups.append({'weightUnits': weight, 'tags': group, 'rule': rule, 'reason': reason, 'scoreTotalsUnits': totals})
    return groups


def stored_counts(snapshot):
    snapshot = {} if snapshot is None else snapshot
    if isinstance(snapshot, dict):
        version = snapshot.get('version', 1)
        counts = snapshot.get('counts', {})
        if (type(version) is int and version in (1, 2) and isinstance(counts, dict)
                and all(tag in TAGS and type(value) is int and 0 <= value <= 5 for tag, value in counts.items())):
            return {tag: counts.get(tag, 0) for tag in TAGS}
    logger.warning('Stored taste profile requires review')
    raise ContractError(409, 'STORED_PROFILE_REVIEW_REQUIRED', '저장된 취향을 확인하고 다시 조사해 주세요.')


def frozen_order(snapshot, counts, tags):
    evidence = snapshot.get('tieEvidence')
    if snapshot.get('version') != 2:
        return None
    if isinstance(evidence, dict):
        order = evidence.get('orderedTags')
        if (evidence.get('policyVersion') == POLICY and evidence.get('binding') == binding(counts, tags)
                and isinstance(order, list) and len(order) == len(tags)
                and all(isinstance(tag, str) for tag in order) and set(order) == set(tags)):
            return order
    logger.warning('Stored taste ordering requires review')
    return None


def resolve(profile, tags, account=None, exhibition_id=None):
    """호출자가 계정 잠금을 먼저 확보한 뒤 현재 조사풀을 읽습니다."""
    if not tags or set(profile['selectedTags']) != set(tags):
        invalid()
    source = profile['source']
    if source == 'saved':
        if account is None or account.role != 'user':
            raise ContractError(401, 'AUTH_REQUIRED', '저장된 취향은 로그인 후 이용해 주세요.')
        if profile['savedProfileVersion'] != account.taste_profile_version:
            conflict()
        if set(tags) != set(account.tastes):
            invalid()
        counts = stored_counts(account.taste_profile)
        snapshot = account.taste_profile or {'version': 1, 'source': 'manual', 'selectedTags': tags, 'counts': counts,
                                             'picks': [], 'poolVersion': None}
        groups = groups_for(counts, tags, frozen=frozen_order(snapshot, counts, tags))
        return snapshot, counts, groups

    require_enabled()
    tags = [tag for tag in TAGS if tag in tags]
    counts = dict.fromkeys(TAGS, 0)
    snapshot = {'version': 2, 'source': source, 'selectedTags': tags, 'picks': [], 'poolVersion': None}
    context_version = approved = None
    if source == 'picks':
        pool = current_pool(lock=True)
        survey, works, pool_version = pool
        if len(works) != 10 or profile['poolVersion'] != pool_version:
            conflict()
        rows, approved, context_version = pool_context(works, pool_version)
        if profile.get('tieContextVersion') != context_version:
            conflict()
        counts, _ = selected_counts(profile, tags, pool=pool)
        picks = sorted(profile['picks'], key=lambda pick: pick['pairIndex'])
        chosen_ids = {pick['artworkId'] for pick in picks}
        groups = groups_for(counts, tags, rows=[row for row in rows if row['id'] in chosen_ids], approved=approved)
        snapshot.update(picks=picks, poolVersion=pool_version, tieContextVersion=context_version,
                        originalPicks=picks, originalPoolVersion=pool_version, originExhibitionId=exhibition_id,
                        originSurveyId=survey.id, originSurveyRevision=survey.revision)
    else:
        if profile['picks'] or profile['poolVersion'] is not None or profile.get('tieContextVersion') is not None:
            invalid('수동 취향에 선택 이력을 넣을 수 없어요.')
        groups = groups_for(counts, tags)
    snapshot.update(counts=counts, tieEvidence={
        'policyVersion': POLICY, 'tieContextVersion': context_version, 'approvedSignature': approved,
        'orderedTags': [tag for group in groups for tag in group['tags']], 'groups': groups,
        'binding': binding(counts, tags),
    })
    return snapshot, counts, groups
