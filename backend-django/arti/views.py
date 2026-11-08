# 공개 전시·작품·추천 조회와 인증·미디어 API를 제공합니다.
import hashlib
import secrets
from datetime import timedelta
from pathlib import Path
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import connection
from django.http import FileResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from .authentication import IsAdmin
from .constants import TAGS
from .http import ContractError
from .models import Account, Artwork, Exhibition, Session
from .recommendations import make_pool, recommend, strength
from .serializers import AdminLoginInput, RecommendInput, artwork_dto, exhibition_dto

DUMMY_PASSWORD = make_password('not-an-account-password')


def public_exhibition(ex_id):
    ex = Exhibition.objects.filter(pk=ex_id, status='running').first()
    if ex is None:
        raise ContractError(404, 'NOT_FOUND', '전시 정보를 찾을 수 없어요.')
    return ex


def public_works(ex_id=None):
    query = Artwork.objects.filter(review_status='approved', exhibition__status='running').select_related('exhibition')
    return query.filter(exhibition_id=ex_id) if ex_id else query


def with_etag(data):
    return Response(data, headers={'ETag': f'"{data["version"]}"'})


@api_view(['GET'])
def health(request):
    return Response({'ok': True, 'service': 'django-api', 'stage': 'W05-development', 'ai': 'not-connected'})


@api_view(['GET'])
def ready(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            # A live TCP connection alone is not a migrated application.
            cursor.execute('SELECT 1 FROM arti_exhibition LIMIT 1')
    except Exception:
        raise ContractError(503, 'DB_NOT_READY', '데이터베이스 준비 중이에요.', retryable=True)
    return Response({'ok': True, 'database': 'postgresql'})


@api_view(['GET'])
def exhibitions(request, ex_id=None):
    if ex_id:
        return with_etag(exhibition_dto(public_exhibition(ex_id)))
    return Response([exhibition_dto(e) for e in Exhibition.objects.filter(status='running')])


@api_view(['GET'])
def artworks(request, artwork_id=None):
    if artwork_id:
        work = public_works().filter(pk=artwork_id).first()
        if work is None:
            raise ContractError(404, 'NOT_FOUND', '작품 정보를 찾을 수 없어요.')
        return with_etag(artwork_dto(work))
    ex_id = request.query_params.get('exhibitionId')
    if ex_id is not None:
        public_exhibition(ex_id)
    return Response([artwork_dto(w) for w in public_works(ex_id)])


@api_view(['GET'])
def coverage(request, ex_id):
    public_exhibition(ex_id)
    works = [w for w in public_works(ex_id) if w.position_x is not None]
    return Response({tag: sum(strength(w, tag) >= .5 for w in works) for tag in TAGS})


@api_view(['GET'])
def taste_pool(request, ex_id):
    public_exhibition(ex_id)
    pool, version = make_pool(public_works(ex_id))
    is_ready = len(pool) == 10
    return Response({'poolVersion': version, 'ready': is_ready,
                     'pairs': [{'leftId': pool[i].id, 'rightId': pool[i+1].id} for i in range(0, 10, 2)] if is_ready else [],
                     'artworks': [artwork_dto(w) for w in pool] if is_ready else []})


@api_view(['POST'])
def recommendations(request):
    body = RecommendInput(data=request.data)
    body.is_valid(raise_exception=True)
    data = body.validated_data
    ex = public_exhibition(data['exhibitionId'])
    return Response(recommend(list(public_works(ex.id)), ex, data['tastes'], data['duration'], data.get('tasteProfile'), request.user))


# 로그인 시도 빈도를 제한합니다.
class LoginThrottle(AnonRateThrottle):
    rate = '10/min'

    def get_cache_key(self,request,view):
        return self.cache_format % {'scope':'login','ident':self.get_ident(request)}


@api_view(['POST'])
@throttle_classes([LoginThrottle])
def admin_login(request):
    form = AdminLoginInput(data=request.data)
    form.is_valid(raise_exception=True)
    account = Account.objects.filter(login_id=form.validated_data['id'], role='admin', status='active').first()
    valid = check_password(form.validated_data['password'], account.password if account else DUMMY_PASSWORD)
    if not account or not valid:
        raise ContractError(401, 'AUTH_REQUIRED', '관리자 ID 또는 비밀번호가 올바르지 않아요.')
    token = secrets.token_urlsafe(32)
    Session.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(), account=account,
                           expires_at=timezone.now()+timedelta(days=14))
    return Response({'name': account.nickname, 'token': token})


@api_view(['POST'])
@permission_classes([IsAdmin])
def admin_logout(request):
    request.auth.delete()
    return Response(status=204)


@api_view(['GET'])
@permission_classes([IsAdmin])
def admin_exhibitions(request, ex_id=None):
    if ex_id:
        ex = Exhibition.objects.filter(pk=ex_id).first()
        if ex is None:
            raise ContractError(404, 'NOT_FOUND', '전시 정보를 찾을 수 없어요.')
        return with_etag(exhibition_dto(ex))
    return Response([exhibition_dto(e) for e in Exhibition.objects.all()])


@api_view(['GET'])
@permission_classes([IsAdmin])
def admin_artworks(request, artwork_id=None):
    query = Artwork.objects.select_related('exhibition').all()
    if artwork_id:
        work = query.filter(pk=artwork_id).first()
        if work is None:
            raise ContractError(404, 'NOT_FOUND', '작품 정보를 찾을 수 없어요.')
        return with_etag(artwork_dto(work, admin=True))
    if 'exhibitionId' in request.query_params:
        query = query.filter(exhibition_id=request.query_params['exhibitionId'])
    return Response([artwork_dto(w, admin=True) for w in query])


@api_view(['GET'])
def media(request, filename):
    if Path(filename).name != filename or filename.startswith('.'):
        raise ContractError(404, 'NOT_FOUND', '파일을 찾을 수 없어요.')
    public_image = public_works().filter(image_file=filename, show_image=True).exists()
    public_plan = Exhibition.objects.filter(status='running', floor_plan__file=filename).exists()
    # Public paths authenticate user tokens only. Admin preview has its own path/header scope.
    admin_preview = request.path.startswith('/api/admin/') and request.user and request.user.role == 'admin'
    if not (public_image or public_plan or admin_preview):
        raise ContractError(404, 'NOT_FOUND', '파일을 찾을 수 없어요.')
    root = settings.MEDIA_ROOT.resolve()
    path = (root/filename).resolve()
    if path.parent != root or not path.is_file():
        raise ContractError(404, 'NOT_FOUND', '파일을 찾을 수 없어요.')
    return FileResponse(path.open('rb'))


@api_view(['GET', 'POST', 'PUT', 'DELETE'])
def unavailable(request, **kwargs):
    # Never forward an unfinished endpoint to Express or fake an AI success.
    raise ContractError(501, 'FEATURE_DISABLED', '이 기능은 다음 통합 단계에서 연결됩니다.')


@api_view(['POST'])
def unavailable_artwork(request, artwork_id):
    if not public_works().filter(pk=artwork_id).exists():
        raise ContractError(404, 'NOT_FOUND', '작품 정보를 찾을 수 없어요.')
    raise ContractError(501, 'FEATURE_DISABLED', '도슨트는 다음 통합 단계에서 연결됩니다.')
