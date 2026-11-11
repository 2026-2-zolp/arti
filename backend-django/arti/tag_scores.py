# 검증된 모델 근거를 서버의 입력 버전에 묶습니다. 승인·공개·동점 정렬은 수행하지 않습니다.
import copy
from django.core.exceptions import ValidationError
from .http import ContractError
from .model_service import validate_tag_evidence
from .constants import TAGS

BINDING_FIELDS = {'sourceVersion', 'inputImageFile'}


def validate_provider_evidence(value, scores):
    """실제 바이트 대조는 model_service에서 수행하고 저장 전 형식/점수 결합을 재확인합니다."""
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(scores, dict) or set(scores) != set(TAGS):
        raise ContractError(502, 'PROVIDER_ERROR', '분석 근거 형식을 확인해 주세요.', retryable=True)
    signature = value.get('signature')
    model_id = signature.get('modelId') if isinstance(signature, dict) else None
    return validate_tag_evidence(value, value.get('imageSha256'), scores, model_id)


def bind_evidence(value, scores, work):
    evidence = validate_provider_evidence(value, scores)
    if evidence is None:
        return None
    if not work.image_file:
        raise ContractError(502, 'PROVIDER_ERROR', '분석 입력 이미지를 확인해 주세요.', retryable=True)
    # 파일 token과 sourceVersion은 공급자나 클라이언트가 정할 수 없습니다.
    return copy.deepcopy(evidence) | {'sourceVersion': work.source_version, 'inputImageFile': work.image_file}


def validate_stored_evidence(work):
    value = work.tag_score_evidence
    try:
        if (not isinstance(value, dict) or not BINDING_FIELDS <= value.keys()
                or type(value['sourceVersion']) is not int or not 1 <= value['sourceVersion'] <= work.source_version
                or not isinstance(value['inputImageFile'], str) or not 1 <= len(value['inputImageFile']) <= 100
                or work.tag_score_revision < 1):
            raise ValueError('Invalid evidence binding')
        validate_provider_evidence({k: v for k, v in value.items() if k not in BINDING_FIELDS}, work.tag_scores)
    except (ContractError, ValueError, TypeError):
        raise ValidationError('Invalid tag score evidence.') from None


def current_evidence(work):
    """후속 서버 검증용 읽기 경계입니다. 확정/입력 일치만 검사하며 승인 signature 비교는 TP2입니다."""
    if work.tag_status != 'confirmed' or work.tag_score_evidence is None:
        return None
    try:
        validate_stored_evidence(work)
    except ValidationError:
        return None
    value = work.tag_score_evidence
    if value['sourceVersion'] != work.source_version or value['inputImageFile'] != work.image_file:
        return None
    return copy.deepcopy(value)
