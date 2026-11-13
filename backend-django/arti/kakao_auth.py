"""기존 ARTI 회원의 카카오 연결과 재로그인 API입니다."""
import base64
import hashlib
import re
import secrets
from datetime import timedelta
from urllib.parse import unquote, urlencode, urlsplit

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from . import kakao
from .http import ContractError
from .member import issue, member
from .models import KakaoIdentity, KakaoOAuthFlow
from .taste_resolution import locked_actor
from .views import LoginThrottle

FLOW_COOKIE = '__Host-arti-kakao-flow'
COOKIE_PATH = '/'
FLOW_TTL = timedelta(minutes=10)
COMPLETE_PATH = '/auth/kakao/complete'
FLOW_KEY = re.compile(r'[A-Za-z0-9_-]{43}')
RETURN_ROUTE = re.compile(r'/(?:mypage|receipt/[^/]+|exhibitions/[^/]+(?:/(?:entry|taste(?:/saved)?))?)?')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def return_path(value):
    if not isinstance(value, str) or len(value) > 500:
        return '/'
    decoded = unquote(value)
    if '\\' in decoded or any(ord(char) < 32 or ord(char) == 127 for char in decoded):
        return '/'
    if not value.startswith('/') or decoded.startswith('//'):
        return '/'
    parts = urlsplit(value)
    path = unquote(parts.path)
    if not RETURN_ROUTE.fullmatch(path) or {'.', '..'}.intersection(path.split('/')) or parts.fragment:
        return '/'
    return value


def private(response):
    response['Cache-Control'] = 'no-store'
    response['Referrer-Policy'] = 'no-referrer'
    return response


def require_configuration():
    if not kakao.configured():
        raise ContractError(404, 'KAKAO_DISABLED', '카카오 로그인을 아직 사용할 수 없어요.')


def require_same_origin(request):
    origin = request.headers.get('Origin')
    callback_url = urlsplit(settings.ARTI_KAKAO_CALLBACK_URL)
    if origin is not None and origin != f'{callback_url.scheme}://{callback_url.netloc}':
        raise ContractError(403, 'KAKAO_INVALID_ORIGIN', 'ARTI 로그인 화면에서 다시 시도해 주세요.')


def flow_query(request):
    browser_key = request.COOKIES.get(FLOW_COOKIE, '')
    if not FLOW_KEY.fullmatch(browser_key):
        return KakaoOAuthFlow.objects.none()
    return KakaoOAuthFlow.objects.filter(browser_hash=digest(browser_key),
                                        client_id=settings.ARTI_KAKAO_CLIENT_ID, expires_at__gt=timezone.now())


@api_view(['GET'])
def status(request):
    enabled = kakao.configured()
    linked = enabled and bool(request.user) and KakaoIdentity.objects.filter(
        account=request.user, client_id=settings.ARTI_KAKAO_CLIENT_ID).exists()
    return private(Response({'enabled': enabled, 'linked': linked}))


@api_view(['POST'])
@throttle_classes([LoginThrottle])
def start(request):
    require_configuration()
    require_same_origin(request)
    mode = request.data.get('mode')
    account = None
    session_hash = ''
    if mode == 'link':
        account = member(request)
        password = request.data.get('password')
        if not isinstance(password, str) or len(password) > 128 or not check_password(password, account.password):
            raise ContractError(400, 'KAKAO_PASSWORD_REQUIRED', '현재 ARTI 비밀번호를 확인해 주세요.')
        if KakaoIdentity.objects.filter(account=account, client_id=settings.ARTI_KAKAO_CLIENT_ID).exists():
            raise ContractError(409, 'KAKAO_ALREADY_LINKED', '이미 카카오 계정이 연결되어 있어요.')
        session_hash = request.auth.pk
    elif mode != 'login' or getattr(request, 'provided_token', False):
        raise ContractError(400, 'KAKAO_INVALID_MODE', '로그인 상태를 확인하고 다시 시도해 주세요.')

    browser_key, state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(4))
    KakaoOAuthFlow.objects.filter(expires_at__lte=timezone.now()).delete()
    flow_query(request).delete()
    KakaoOAuthFlow.objects.create(
        browser_hash=digest(browser_key), state_hash=digest(state), client_id=settings.ARTI_KAKAO_CLIENT_ID,
        account=account, session_hash=session_hash, nonce=nonce, verifier=verifier,
        return_path='/mypage' if account else return_path(request.data.get('returnTo')),
        expires_at=timezone.now() + FLOW_TTL,
    )
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    url = kakao.ISSUER + '/oauth/authorize?' + urlencode({
        'client_id': settings.ARTI_KAKAO_CLIENT_ID, 'redirect_uri': settings.ARTI_KAKAO_CALLBACK_URL,
        'response_type': 'code', 'state': state, 'nonce': nonce, 'code_challenge_method': 'S256',
        'code_challenge': challenge, **({'prompt': 'login'} if account else {}),
    })
    response = private(Response({'authorizationUrl': url}))
    response.set_cookie(FLOW_COOKIE, browser_key, max_age=int(FLOW_TTL.total_seconds()), path=COOKIE_PATH,
                        secure=True, httponly=True, samesite='Lax')
    return response


@api_view(['GET'])
def callback(request):
    require_configuration()
    states = request.query_params.getlist('state')
    if len(states) != 1 or not FLOW_KEY.fullmatch(states[0]):
        return private(HttpResponseRedirect(COMPLETE_PATH))
    query = flow_query(request).filter(state_hash=digest(states[0]))
    with transaction.atomic():
        flow = query.select_for_update().filter(status='pending').first()
        if flow is None:
            return private(HttpResponseRedirect(COMPLETE_PATH))
        # 외부 요청 전에 한 번만 가져갈 수 있도록 상태를 바꿉니다.
        flow.status = 'exchanging'
        flow.save(update_fields=['status'])
    codes = request.query_params.getlist('code')
    errors = request.query_params.getlist('error')
    subject = ''
    if errors == ['access_denied'] and not codes:
        result = 'cancelled'
    elif errors or len(codes) != 1 or not 1 <= len(codes[0]) <= 2048:
        result = 'failed'
    else:
        try:
            subject = kakao.exchange_subject(codes[0], flow.verifier, flow.nonce)
            result = 'ready'
        except ContractError:
            result = 'failed'
    query.filter(status='exchanging').update(status=result, subject=subject, nonce='', verifier='')
    # The fragment stays in the browser and ties the completion screen to this callback.
    return private(HttpResponseRedirect(f'{COMPLETE_PATH}#state={states[0]}'))


@api_view(['POST'])
@throttle_classes([LoginThrottle])
def finish(request):
    require_configuration()
    require_same_origin(request)
    state = request.data.get('state')
    if not isinstance(state, str) or not FLOW_KEY.fullmatch(state):
        raise ContractError(400, 'KAKAO_INVALID_FLOW', '카카오 로그인 요청을 다시 시작해 주세요.')
    with transaction.atomic():
        flow = flow_query(request).select_for_update().filter(state_hash=digest(state)).exclude(
            status__in=['pending', 'exchanging']).first()
        if flow is None:
            raise ContractError(400, 'KAKAO_INVALID_FLOW', '카카오 로그인 요청을 다시 시작해 주세요.')
        if flow.account_id:
            if not request.auth or request.auth.pk != flow.session_hash:
                raise ContractError(403, 'KAKAO_ACTOR_CHANGED', '연결을 시작한 ARTI 계정으로 다시 시도해 주세요.')
            account = locked_actor(request)
            if account.id != flow.account_id:
                raise ContractError(403, 'KAKAO_ACTOR_CHANGED', '연결을 시작한 ARTI 계정으로 다시 시도해 주세요.')
        elif getattr(request, 'provided_token', False):
            raise ContractError(409, 'KAKAO_ACTOR_CHANGED', '현재 계정에서 로그아웃한 뒤 다시 시도해 주세요.')

        flow.delete()
        if flow.status != 'ready':
            response = Response({'status': flow.status, 'returnTo': flow.return_path})
        elif flow.account_id:
            try:
                with transaction.atomic():
                    KakaoIdentity.objects.get_or_create(client_id=flow.client_id, subject=flow.subject,
                                                       account=account)
                response = Response({'status': 'linked', 'returnTo': '/mypage'})
            except IntegrityError:
                response = Response({'status': 'conflict', 'returnTo': '/mypage'})
        else:
            identity = KakaoIdentity.objects.select_related('account').select_for_update(of=('account',)).filter(
                client_id=flow.client_id, subject=flow.subject, account__role='user', account__status='active').first()
            if identity:
                response = issue(identity.account)
                response.data.update(status='logged_in', returnTo=flow.return_path)
            else:
                response = Response({'status': 'unlinked', 'returnTo': flow.return_path})
    response.delete_cookie(FLOW_COOKIE, path=COOKIE_PATH, samesite='Lax')
    return private(response)
