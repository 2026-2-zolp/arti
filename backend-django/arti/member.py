# 회원 가입·로그인·취향 저장과 계정 경계를 처리합니다.
import re
import hashlib
import secrets
from datetime import timedelta
from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from .http import ContractError
from .models import Account, Session
from .model_service import evidence_digest
from .recommendations import profile_snapshot
from .serializers import TasteProfileInput
from .taste_evidence import profile_input, uuid_value
from .taste_resolution import conflict, invalid, locked_actor, resolve, taste_transaction
from .constants import TAGS
from .views import DUMMY_PASSWORD, LoginThrottle, public_exhibition


def member(request, user_id=None):
    if not request.user or request.user.role != 'user':
        raise ContractError(401, 'SESSION_EXPIRED' if getattr(request, 'provided_token', False) else 'AUTH_REQUIRED', '다시 로그인해 주세요.')
    if user_id and request.user.id != user_id:
        raise ContractError(403, 'FORBIDDEN', '본인 기록만 이용할 수 있어요.')
    return request.user


def user_dto(a):
    return dict(id=a.id, email=a.email, nickname=a.nickname, tastes=a.tastes, status=a.status,
                createdAt=a.created_at.isoformat(), tasteProfile=a.taste_profile, tasteProfileVersion=a.taste_profile_version)


def issue(a):
    token = secrets.token_urlsafe(32)
    Session.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(), account=a,
                           expires_at=timezone.now()+timedelta(days=14))
    return Response({'user': user_dto(a), 'token': token})


@api_view(['POST'])
@throttle_classes([LoginThrottle])
def signup(request):
    email = request.data.get('email', '')
    password = request.data.get('password', '')
    nickname = request.data.get('nickname', '')
    if not isinstance(email, str) or not isinstance(password, str) or not isinstance(nickname, str):
        raise ContractError(400, 'VALIDATION_ERROR', '가입 정보를 확인해 주세요.')
    email = email.strip().lower()
    if len(email)>254:raise ContractError(400,'VALIDATION_ERROR','이메일 길이를 확인해 주세요.')
    try:
        validate_email(email)
    except ValidationError:
        raise ContractError(400, 'VALIDATION_ERROR', '이메일 형식을 확인해 주세요.')
    if not 8 <= len(password) <= 128 or not re.search(r'[A-Za-z]',password) or not re.search(r'[0-9]',password):
        raise ContractError(400, 'VALIDATION_ERROR', '비밀번호는 영문·숫자 포함 8~128자로 입력해 주세요.')
    # 닉네임은 화면과 동일하게 선택 입력이며, 공백은 빈 값으로 보존합니다.
    if len(nickname.strip()) > 100:
        raise ContractError(400, 'VALIDATION_ERROR', '닉네임은 100자 이내로 입력해 주세요.')
    try:
        with transaction.atomic():
            a = Account.objects.create(login_id=email, email=email, nickname=nickname.strip(), role='user', password=make_password(password))
    except IntegrityError:
        raise ContractError(400, 'VALIDATION_ERROR', '가입 정보를 확인해 주세요.')
    return issue(a)


@api_view(['POST'])
@throttle_classes([LoginThrottle])
def login(request):
    email, password = request.data.get('email'), request.data.get('password')
    if not isinstance(email, str) or not isinstance(password, str) or len(password) > 128:
        raise ContractError(400, 'VALIDATION_ERROR', '로그인 정보를 확인해 주세요.')
    a = Account.objects.filter(login_id=email.strip().lower(), role='user', status='active').first()
    valid = check_password(password, a.password if a else DUMMY_PASSWORD)
    if not a or not valid:
        raise ContractError(401, 'AUTH_REQUIRED', '이메일 또는 비밀번호가 올바르지 않아요.')
    return issue(a)


@api_view(['GET'])
def me(request):
    return Response(user_dto(member(request)))


@api_view(['POST'])
def logout(request):
    member(request)
    request.auth.delete()
    return Response(status=204)


@api_view(['PUT'])
def tastes(request, user_id):
    member(request, user_id)
    tags = request.data.get('tastes')
    profile = request.data.get('tasteProfile')
    if profile is not None and not isinstance(profile,dict):
        raise ContractError(400,'VALIDATION_ERROR','취향 프로필을 확인해 주세요.')
    if profile and profile.get('source') == 'saved':
        raise ContractError(400, 'VALIDATION_ERROR', '새 선택 또는 수동 태그만 저장할 수 있어요.')
    ex_id = request.data.get('exhibitionId')
    if ex_id is not None and not isinstance(ex_id, str):
        invalid()
    if not isinstance(tags, list) or any(not isinstance(tag, str) or tag not in TAGS for tag in tags) or len(set(tags)) != len(tags):
        invalid()
    if profile is not None:
        form = TasteProfileInput(data=profile)
        form.is_valid(raise_exception=True)
        profile = form.validated_data
    v2 = profile is not None and profile['version'] == 2
    expected = request.data.get('expectedSavedProfileVersion')
    if (v2 or 'expectedSavedProfileVersion' in request.data) and (type(expected) is not int or expected < 1):
        invalid('현재 저장된 취향 버전이 필요해요.')
    if v2 and set(tags) != set(profile['selectedTags']):
        invalid()
    mutation = uuid_value(request.data.get('clientMutationId')) if v2 else None
    request_hash = evidence_digest({'version': expected, 'exhibitionId': ex_id, 'profile': profile_input(profile),
                                    'counts': profile['counts']}) if v2 else None
    with taste_transaction():
        account = locked_actor(request)
        receipt = account.taste_write_receipt or {}
        if v2 and receipt.get('mutationId') == mutation:
            if (receipt.get('requestHash') != request_hash or receipt.get('savedVersion') != account.taste_profile_version
                    or receipt.get('binding') != evidence_digest([account.tastes, account.taste_profile])):
                conflict()
            return Response(status=204)
        if expected is not None and expected != account.taste_profile_version:
            conflict()
        if expected is None and isinstance(account.taste_profile, dict) and account.taste_profile.get('version') == 2:
            conflict()
        if ex_id:
            public_exhibition(ex_id)
        if v2:
            snapshot, _, _ = resolve(profile, tags, account, ex_id)
            tags = snapshot['selectedTags']
        else:
            snapshot = profile_snapshot(tags, profile, [], account, ex_id)
        fields = ['taste_write_receipt']
        if not v2 or (account.tastes, account.taste_profile) != (tags, snapshot):
            account.tastes, account.taste_profile = tags, snapshot
            account.taste_profile_version += 1
            fields += ['tastes', 'taste_profile', 'taste_profile_version']
        account.taste_write_receipt = {
            'mutationId': mutation, 'requestHash': request_hash, 'savedVersion': account.taste_profile_version,
            'binding': evidence_digest([account.tastes, account.taste_profile]),
        } if v2 else None
        account.save(update_fields=fields)
    return Response(status=204)


@api_view(['POST'])
def reset_disabled(request):
    raise ContractError(501, 'FEATURE_DISABLED', '비밀번호 재설정은 아직 제공되지 않아요. 로그인 화면으로 돌아가 주세요.')
