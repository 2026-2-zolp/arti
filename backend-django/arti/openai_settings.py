"""Admin-managed credentials for the server's official OpenAI connection."""
import re
from dataclasses import dataclass, field

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .authentication import IsAdmin
from .http import ContractError
from .models import AdminOpenAISettings


OFFICIAL_BASE = 'https://api.openai.com/v1'
MODEL_ID = re.compile(r'(?:gpt-|o[0-9]|ft:gpt-)[A-Za-z0-9._:-]{0,190}\Z')
PROJECT_KEY = re.compile(r'sk-[A-Za-z0-9_-]{12,500}\Z')


@dataclass(frozen=True)
class TextRuntime:
    provider: str
    model: str
    api_key: str = field(repr=False)


def vault():
    configured = settings.ARTI_AI_SETTINGS_ENCRYPTION_KEY
    if not configured or settings.OPENAI_BASE_URL.rstrip('/') != OFFICIAL_BASE:
        return None
    try:
        return Fernet(configured.encode('ascii'))
    except (UnicodeError, ValueError):
        return None


def decrypt(store, row):
    try:
        return store.decrypt(bytes(row.encrypted_key)).decode('ascii')
    except (InvalidToken, UnicodeError):
        return ''


def stored_override(store):
    return AdminOpenAISettings.objects.filter(pk=1).first() if store is not None else None


def text_runtime(kind):
    store = vault()
    if invalid_vault(store):
        return TextRuntime('invalid', '', '')
    row = stored_override(store)
    if row is None:
        model = (settings.ARTI_LLM_MODELS.get(kind) or settings.OPENAI_MODEL).strip()
        return TextRuntime(settings.ARTI_LLM_PROVIDER, model, settings.OPENAI_API_KEY.strip())
    key = decrypt(store, row) if row.encrypted_key else settings.OPENAI_API_KEY.strip()
    return TextRuntime('openai_compatible' if row.enabled else 'disabled', row.model, key)


def voice_key():
    """Retain the existing test-only voice policy with the environment key as its default."""
    if settings.OPENAI_BASE_URL.rstrip('/') != OFFICIAL_BASE:
        return ''
    store = vault()
    if invalid_vault(store):
        return ''
    row = stored_override(store)
    if row is None:
        return settings.OPENAI_API_KEY.strip()
    if not row.enabled:
        return ''
    return decrypt(store, row) if row.encrypted_key else settings.OPENAI_API_KEY.strip()


def safe_model(value):
    return value if MODEL_ID.fullmatch(value) else ''


def invalid_vault(store):
    return (store is None and bool(settings.ARTI_AI_SETTINGS_ENCRYPTION_KEY)
            and settings.OPENAI_BASE_URL.rstrip('/') == OFFICIAL_BASE)


def dto(store, row):
    model = (settings.ARTI_LLM_MODELS.get('answer') or settings.OPENAI_MODEL).strip() if row is None else row.model
    effective = 'environment' if settings.OPENAI_API_KEY.strip() else 'missing'
    if row is not None and row.encrypted_key:
        effective = 'saved' if decrypt(store, row) else 'unreadable'
    if invalid_vault(store):
        effective = 'unreadable'
    return {
        'editable': store is not None,
        'enabled': settings.ARTI_LLM_PROVIDER == 'openai_compatible' if row is None else row.enabled,
        'keyStatus': effective,
        'model': safe_model(model),
        'revision': 0 if row is None else row.revision,
        'draftUsesSeparateProvider': settings.ARTI_DRAFT_PROVIDER != 'default',
    }


def invalid():
    return ContractError(400, 'VALIDATION_ERROR', '모델 ID와 API 키 입력을 확인해 주세요.')


@api_view(['GET', 'PUT'])
@permission_classes([IsAdmin])
def admin_openai_settings(request):
    store = vault()
    if request.method == 'GET':
        return Response(dto(store, stored_override(store)), headers={'Cache-Control': 'no-store'})
    if store is None:
        raise ContractError(503, 'AI_SETTINGS_UNAVAILABLE', 'OpenAI 공식 연결과 서버 암호화 키를 설정해 주세요.')
    # The production edge overwrites this header; the API port is loopback or private.
    if settings.ARTI_ENV == 'production' and not (request.is_secure() or request.headers.get('X-Forwarded-Proto') == 'https'):
        raise ContractError(403, 'HTTPS_REQUIRED', 'HTTPS로 접속해 AI 설정을 저장해 주세요.')
    data = request.data
    if set(data) - {'enabled', 'model', 'revision', 'apiKey'}:
        raise invalid()
    enabled, model, revision = data.get('enabled'), data.get('model'), data.get('revision')
    api_key = data.get('apiKey', '')
    if (type(enabled) is not bool or not isinstance(model, str) or not MODEL_ID.fullmatch(model)
            or type(revision) is not int or not 0 <= revision < 2**63 - 1
            or not isinstance(api_key, str) or (api_key and not PROJECT_KEY.fullmatch(api_key))):
        raise invalid()

    with transaction.atomic():
        row, _ = AdminOpenAISettings.objects.select_for_update().get_or_create(
            pk=1, defaults={'model': model},
        )
        if revision != row.revision:
            raise ContractError(409, 'STALE_AI_SETTINGS', '설정이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.', retryable=True)
        available_key = api_key or (decrypt(store, row) if row.encrypted_key else settings.OPENAI_API_KEY.strip())
        if enabled and not available_key:
            raise ContractError(400, 'API_KEY_REQUIRED', 'OpenAI 프로젝트 API 키를 먼저 등록해 주세요.')
        if api_key:
            row.encrypted_key = store.encrypt(api_key.encode('ascii'))
        row.enabled, row.model, row.revision = enabled, model, row.revision + 1
        row.save(update_fields=['enabled', 'model', 'encrypted_key', 'revision'])
    return Response(dto(store, row), headers={'Cache-Control': 'no-store'})
