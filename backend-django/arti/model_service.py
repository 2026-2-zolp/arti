# 내부 FastAPI 분석 서비스에 원본 자료를 전달하고 완전한 점수 응답만 허용합니다.
import base64
import json
import math
import socket
from pathlib import Path
from http.client import HTTPException as HTTPTransportError
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener
from django.conf import settings
from .constants import TAGS, EMOTIONS
from .http import ContractError
from .llm import NoRedirect
from .budget import remaining

TIMEOUT_SECONDS = 30
MAX_IMAGE = 10 * 1024 * 1024
MAX_RESPONSE = 128 * 1024


def failure(status=502, code='PROVIDER_ERROR'):
    raise ContractError(status, code, '분석 서비스 응답을 확인해 주세요.', retryable=True)


def analyze(snapshot, *, deadline=None):
    base = settings.ARTI_MODEL_SERVICE_URL.rstrip('/')
    try:
        url = urlsplit(base)
    except ValueError:
        failure(503, 'AI_UNAVAILABLE')
    # 관리자가 배포 설정한 내부 주소만 사용하며 작품의 URL은 원격에서 가져오지 않습니다.
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        failure(503, 'AI_UNAVAILABLE')
    payload = {'title': snapshot.get('title', ''), 'description': snapshot.get('description', '')}
    name = snapshot.get('imageFile')
    if name:
        root = Path(settings.MEDIA_ROOT).resolve()
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            failure()
        try:
            with path.open('rb') as stream:
                content = stream.read(MAX_IMAGE + 1)
        except OSError:
            failure()
        if not content or len(content) > MAX_IMAGE:
            failure()
        payload['imageBase64'] = base64.b64encode(content).decode('ascii')
    elif snapshot.get('imageUrl'):
        # 외부 이미지 다운로드/SSRF 정책은 별도이며 조용한 텍스트 대체를 막습니다.
        failure(503, 'AI_UNAVAILABLE')
    request = Request(base + '/analyze', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=remaining(deadline, TIMEOUT_SECONDS)) as response:
            raw = response.read(MAX_RESPONSE + 1)
        remaining(deadline, TIMEOUT_SECONDS)
        if len(raw) > MAX_RESPONSE:
            failure()
        value = json.loads(raw)
    except HTTPError as exc:
        status=exc.code
        exc.close()
        if status == 429:
            error=ContractError(429,'RATE_LIMITED','다른 분석을 진행 중이에요. 잠시 후 다시 시도해 주세요.',retryable=True)
            error.wait=1
            raise error
        if status == 503:
            failure(503, 'AI_UNAVAILABLE')
        failure()
    except (TimeoutError, socket.timeout):
        failure(504, 'AI_TIMEOUT')
    except URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            failure(504, 'AI_TIMEOUT')
        failure(503, 'AI_UNAVAILABLE')
    except (ValueError, OSError, HTTPTransportError):
        failure()
    if not isinstance(value, dict):
        failure()
    for field, keys in [('tags', TAGS), ('emotions', EMOTIONS)]:
        scores = value.get(field)
        if not isinstance(scores, dict) or set(scores) != set(keys):
            failure()
        if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in scores.values()):
            failure()
    if type(value.get('usedImage')) is not bool or type(value.get('usedText')) is not bool:
        failure()
    if name and (not value['usedImage'] or value.get('imageError') or value.get('tagSource') != 'image'):
        failure()
    if not value['usedImage'] and not value['usedText']:
        failure()
    models = value.get('models')
    if not isinstance(models, dict) or any(not isinstance(models.get(k), str) or not models[k] for k in ('image', 'text')):
        failure()
    # 공급자 임의 필드를 DB나 공개 응답으로 전달하지 않습니다.
    return {k: value[k] for k in ('emotions', 'models', 'usedImage', 'usedText', 'tags', 'tagSource') if k in value} | {'imageError': None}
