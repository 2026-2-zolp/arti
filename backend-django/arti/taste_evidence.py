# 관람 영수증에만 쓰는 서명된 취향 snapshot을 발급하고 확인합니다.
import uuid

from django.core import signing

from .http import ContractError
from .model_service import evidence_digest
from .taste_resolution import binding, invalid, stored_counts

PURPOSE = 'arti.taste-visit-evidence.v1'
MAX_BYTES = 8192
MAX_AGE = 72 * 60 * 60


def uuid_value(value, *, visit=False):
    try:
        identifier = uuid.UUID(value)
    except (TypeError, ValueError, AttributeError):
        invalid('유효한 요청 식별자가 필요해요.')
    if visit and identifier.version != 4:
        invalid('유효한 관람 식별자가 필요해요.')
    return str(identifier)


def profile_input(profile):
    result = {key: profile[key] for key in ('version', 'source', 'poolVersion', 'tieContextVersion',
                                           'savedProfileVersion') if key in profile and profile[key] is not None}
    result['selectedTags'] = sorted(profile['selectedTags'])
    result['picks'] = sorted(profile.get('picks', []), key=lambda pick: pick['pairIndex'])
    return result


def issue_visit_evidence(account, visit_id, exhibition_id, profile, snapshot, counts):
    value = {
        'version': 1, 'purpose': PURPOSE, 'actor': account.id if account else None,
        'visitId': visit_id, 'exhibitionId': exhibition_id, 'profileHash': evidence_digest(profile_input(profile)),
        'binding': binding(counts, profile['selectedTags']), 'snapshot': snapshot,
    }
    receipt = signing.dumps(value, salt=PURPOSE, compress=True)
    if len(receipt) > MAX_BYTES:
        invalid('관람 취향 근거가 너무 커요.')
    return receipt


def read_visit_evidence(receipt, account, visit_id, exhibition_id, profile, tags):
    if not isinstance(receipt, str) or not receipt.isascii() or not 0 < len(receipt) <= MAX_BYTES:
        invalid('관람 취향 근거가 필요해요.')
    try:
        value = signing.loads(receipt, salt=PURPOSE, max_age=MAX_AGE)
    except signing.SignatureExpired:
        raise ContractError(409, 'VISIT_EVIDENCE_EXPIRED', '관람 근거가 만료됐어요. 기록을 보존하고 취향을 다시 확인해 주세요.') from None
    except signing.BadSignature:
        invalid('관람 취향 근거를 확인해 주세요.')
    if (value['version'] != 1 or value['purpose'] != PURPOSE or value['actor'] != (account.id if account else None)
            or value['visitId'] != visit_id or value['exhibitionId'] not in (None, exhibition_id)
            or set(tags) != set(profile['selectedTags'])
            or value['profileHash'] != evidence_digest(profile_input(profile))):
        invalid('관람과 취향 근거가 일치하지 않아요.')
    snapshot = value['snapshot']
    if value['binding'] != binding(stored_counts(snapshot), tags):
        invalid('관람 취향 근거를 확인해 주세요.')
    return snapshot


def receipt_hash(value):
    if value is None:
        return None
    if not isinstance(value, str) or not value.isascii() or not 0 < len(value) <= MAX_BYTES:
        invalid('관람 취향 근거를 확인해 주세요.')
    return evidence_digest(value)
