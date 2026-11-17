# 텍스트 생성과 태그·감정 분석의 제공자 경계를 관리합니다.
"""Explicit provider boundary; disabled by default, never fake success/fallback."""
from django.conf import settings
from django.utils import timezone
from .http import ContractError
from .llm import DRAFT_TASKS, GUIDE_REVIEW_TASK, generate_text, text_connection_settings


def configuration_status():
    """외부 호출 없이 도슨트와 작품 분석의 설정 상태만 반환합니다."""
    from .model_service import model_service_base

    docent = 'disabled'
    if settings.ARTI_LLM_PROVIDER == 'openai_compatible':
        try:
            text_connection_settings('answer')
            docent = 'configured'
        except ContractError:
            docent = 'invalid'
    elif settings.ARTI_LLM_PROVIDER != 'disabled':
        docent = 'invalid'

    analysis = 'disabled'
    if settings.ARTI_MODEL_SERVICE_URL:
        try:
            model_service_base()
            analysis = 'configured'
        except ContractError:
            analysis = 'invalid'
    return {'docent': docent, 'analysis': analysis}


def draft_configuration_status():
    if settings.ARTI_DRAFT_PROVIDER == 'default' and settings.ARTI_LLM_PROVIDER == 'disabled':
        return 'disabled'
    try:
        for kind in DRAFT_TASKS:
            text_connection_settings(kind)
        return 'configured'
    except ContractError:
        return 'invalid'


def generate(kind, snapshot, **context):
    if kind in ('tag', 'emotion'):
        if not settings.ARTI_MODEL_SERVICE_URL:
            raise ContractError(503, 'AI_UNAVAILABLE', '분석 모델 연결을 준비 중이에요.', retryable=True)
        from .model_service import analyze
        cache = context.get('analysis_cache', {})
        if 'error' in cache:
            raise cache['error']
        if 'result' not in cache:
            try:
                cache['result'] = analyze(
                    snapshot, deadline=context.get('deadline'), use_image=context.get('use_image', True),
                )
            except ContractError as exc:
                cache['error'] = exc
                raise
        result = cache['result']
        # 태그에만 선택적 근거를 전달하고 감정 JSON에는 섞지 않습니다.
        if kind == 'tag':
            return {'scores': result['tags']} | ({'tagEvidence': result['tagEvidence']} if result.get('tagEvidence') is not None else {})
        return {k: v for k, v in result.items() if k != 'tagEvidence'} | {'analyzedAt': timezone.now().isoformat()}
    if settings.ARTI_LLM_PROVIDER == 'openai_compatible' or (kind in DRAFT_TASKS and settings.ARTI_DRAFT_PROVIDER != 'default'):
        return generate_text(kind, snapshot, **context)
    raise ContractError(503, 'AI_UNAVAILABLE', 'AI 연결을 준비 중이에요. 잠시 후 다시 시도해 주세요.', retryable=True)


def review_guide(snapshot, candidate, **context):
    verdict = generate_text(GUIDE_REVIEW_TASK, snapshot, guide_candidate=candidate, **context)
    if not verdict['supported']:
        raise ContractError(502, 'GUIDE_UNSUPPORTED', '가이드의 위치나 작가 의도를 작품 자료에서 확인하지 못했어요.', retryable=True)


def validate(kind,value):
    import math
    from .constants import TAGS, EMOTIONS
    def text(v,maximum=10000):return isinstance(v,str) and 0<len(v.strip())<=maximum
    def texts(v,maximum=50):return isinstance(v,list) and len(v)<=maximum and all(isinstance(x,str) and len(x)<=10000 for x in v)
    def scores(v,keys):return isinstance(v,dict) and bool(v) and all(k in keys and type(n) in (int,float) and math.isfinite(n) and 0<=n<=1 for k,n in v.items())
    valid=isinstance(value,dict)
    if valid:
        if kind=='summary':valid=text(value.get('summary')) and texts(value.get('keywords'))
        elif kind=='guide':
            questions, hints = value.get('questions'), value.get('hints')
            valid = (
                text(value.get('intro'))
                and texts(questions, 3) and bool(questions)
                and all(text(question) for question in questions)
                and texts(hints, 3) and len(questions) == len(hints)
            )
        elif kind == GUIDE_REVIEW_TASK:
            valid = type(value.get('supported')) is bool
        elif kind=='tag':
            valid=scores(value.get('scores'),TAGS)
            if valid:
                from .tag_scores import validate_provider_evidence
                validate_provider_evidence(value.get('tagEvidence'),value['scores'])
        elif kind=='emotion':valid=scores(value.get('emotions'),EMOTIONS)
        elif kind in ('interpret','explanation'):valid=text(value.get('text'))
        elif kind=='answer':
            valid=text(value.get('answer'),1000) and isinstance(value.get('insufficientEvidence', False), bool)
    if not valid:raise ContractError(502,'PROVIDER_ERROR','AI 응답 형식을 확인할 수 없어요.',retryable=True)
