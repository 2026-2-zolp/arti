# 역할별 불투명 세션 토큰을 확인하고 관리자 권한을 검사합니다.
import hashlib
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import BasePermission
from .http import ContractError
from .models import Session


# 불투명 토큰으로 요청 계정과 역할을 확인합니다.
class OpaqueAuthentication(BaseAuthentication):
    """Only protected views enforce validity; public catalog remains guest-readable."""
    def authenticate(self, request):
        admin_path = request.path.startswith('/api/admin/')
        value = request.headers.get('X-Admin-Token', '') if admin_path else request.headers.get('Authorization', '')
        parts = value.split()
        token = value if admin_path else parts[1] if len(parts) == 2 and parts[0].lower() == 'bearer' else ''
        request.provided_token = bool(value)
        if not token:
            return None
        session = Session.objects.select_related('account').filter(token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at__gt=timezone.now()).first()
        role = 'admin' if admin_path else 'user'
        if session and session.account.role == role and session.account.status == 'active':
            return session.account, session
        return None


# 관리자 역할이 필요한 API 접근을 제한합니다.
class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        if not request.user:
            raise ContractError(401, 'AUTH_REQUIRED', '관리자 로그인이 필요해요.')
        if request.user.role != 'admin':
            raise ContractError(403, 'FORBIDDEN', '관리자 권한이 필요해요.')
        return True
