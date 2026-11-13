"""카카오 인가 코드 교환과 ID 토큰의 검증된 회원번호를 처리합니다."""
import json
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener

import jwt
from django.conf import settings

from .http import ContractError
from .llm import NoRedirect

ISSUER = 'https://kauth.kakao.com'
CALLBACK_PATH = '/api/auth/kakao/callback'
TIMEOUT = 5
MAX_RESPONSE = 64 * 1024


def configured():
    try:
        callback = urlsplit(settings.ARTI_KAKAO_CALLBACK_URL)
        return bool(
            0 < len(settings.ARTI_KAKAO_CLIENT_ID) <= 128 and settings.ARTI_KAKAO_CLIENT_SECRET
            and callback.scheme == 'https' and callback.hostname and not callback.username
            and not callback.password and not callback.query and not callback.fragment
            and settings.ARTI_KAKAO_CALLBACK_URL.endswith(CALLBACK_PATH)
            and callback.path == CALLBACK_PATH
        )
    except ValueError:
        return False


def request_json(request):
    with build_opener(NoRedirect()).open(request, timeout=TIMEOUT) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError('Response exceeds limit')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Object required')
    return value


def exchange_subject(code, verifier, nonce):
    client_id = settings.ARTI_KAKAO_CLIENT_ID
    request = Request(ISSUER + '/oauth/token', data=urlencode({
        'grant_type': 'authorization_code',
        'client_id': client_id,
        'client_secret': settings.ARTI_KAKAO_CLIENT_SECRET,
        'redirect_uri': settings.ARTI_KAKAO_CALLBACK_URL,
        'code': code,
        'code_verifier': verifier,
    }).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    try:
        id_token = request_json(request)['id_token']
        if not isinstance(id_token, str) or len(id_token) > 8192:
            raise ValueError('Invalid token')
        header = jwt.get_unverified_header(id_token)
        if header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str) or not header['kid']:
            raise ValueError('Invalid signing header')
        jwks = request_json(Request(ISSUER + '/.well-known/jwks.json'))
        keys = [key for key in jwks['keys'] if isinstance(key, dict) and key.get('kid') == header['kid']
                and key.get('kty') == 'RSA' and key.get('use', 'sig') == 'sig'
                and key.get('alg', 'RS256') == 'RS256']
        if len(keys) != 1:
            raise ValueError('Unknown signing key')
        claims = jwt.decode(id_token, jwt.PyJWK.from_dict(keys[0], algorithm='RS256'),
                            algorithms=['RS256'], audience=client_id, issuer=ISSUER,
                            options={'require': ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce'],
                                     'strict_aud': True, 'enforce_minimum_key_length': True})
        subject = claims['sub']
        if claims['nonce'] != nonce or not isinstance(subject, str) or not 1 <= len(subject) <= 255:
            raise ValueError('Invalid identity')
        return subject
    except (OSError, ValueError, TypeError, KeyError, jwt.PyJWTError):
        raise ContractError(502, 'KAKAO_PROVIDER_ERROR', '카카오 인증을 확인하지 못했어요. 다시 시도해 주세요.',
                            retryable=True) from None
