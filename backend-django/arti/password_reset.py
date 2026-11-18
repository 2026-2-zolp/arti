"""메일을 확인한 ARTI 회원의 비밀번호를 일회용 링크로 변경합니다."""
import logging
import re
from datetime import timedelta
from smtplib import SMTPException
from urllib.parse import urlencode, urlsplit
from uuid import UUID, uuid4

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import connection, transaction
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework.decorators import api_view, authentication_classes, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .http import ContractError
from .member import validate_member_password
from .models import Account, PasswordResetDelivery, Session

logger = logging.getLogger(__name__)
LINK_TTL = timedelta(minutes=30)
EMAIL_LIMIT = 3
TOKEN = re.compile(r'([a-f0-9]{32})\.([a-f0-9]{64})')
RESET_HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}


class ResetThrottle(AnonRateThrottle):
    scope = 'password-reset'
    rate = '30/hour'


def reset_enabled():
    try:
        origin = urlsplit(settings.ARTI_PASSWORD_RESET_ORIGIN)
        validate_email(settings.ARTI_PASSWORD_RESET_FROM)
        local = (settings.ARTI_ENV in ('test', 'development') and origin.scheme == 'http'
                 and origin.hostname in ('localhost', '127.0.0.1', '::1'))
        return bool((local or origin.scheme == 'https') and origin.hostname and not origin.username
                    and not origin.password and not (origin.path or origin.query or origin.fragment)
                    and (settings.ARTI_ENV in ('test', 'development')
                         or settings.EMAIL_BACKEND == 'django.core.mail.backends.smtp.EmailBackend'))
    except (ValueError, ValidationError):
        return False


def require_enabled():
    if not reset_enabled():
        raise ContractError(501, 'FEATURE_DISABLED', '비밀번호 재설정은 아직 제공되지 않아요.')


def keyed_digest(purpose, value):
    return salted_hmac(f'arti.password-reset.{purpose}', value, algorithm='sha256').hexdigest()


def eligible_accounts():
    return Account.objects.filter(role='user', status='active').exclude(email='').exclude(password__startswith='!')


@api_view(['GET'])
@authentication_classes([])
def status(_request):
    return Response({'enabled': reset_enabled()}, headers=RESET_HEADERS)


@api_view(['POST'])
@authentication_classes([])
@throttle_classes([ResetThrottle])
def request_reset(request):
    require_enabled()
    email = request.data.get('email')
    if not isinstance(email, str) or len(email) > 254:
        raise ContractError(400, 'VALIDATION_ERROR', '이메일 형식을 확인해 주세요.')
    email = email.strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        raise ContractError(400, 'VALIDATION_ERROR', '이메일 형식을 확인해 주세요.') from None

    now = timezone.now()
    email_key = keyed_digest('email', email)
    with transaction.atomic():
        with connection.cursor() as cursor:
            lock_key = int.from_bytes(bytes.fromhex(email_key[:16]), 'big', signed=True)
            cursor.execute('SELECT pg_advisory_xact_lock(%s)', [lock_key])
        if PasswordResetDelivery.objects.filter(email_key=email_key, expires_at__gt=now).count() < EMAIL_LIMIT:
            account = eligible_accounts().filter(login_id=email, email__iexact=email).first()
            # 요청은 수신함 존재 여부와 무관하게 같은 흐름을 거칩니다. 메일 발송은 별도 명령에서 합니다.
            PasswordResetDelivery.objects.create(account=account, email_key=email_key, token_id=uuid4(),
                                                 expires_at=now + LINK_TTL, next_attempt_at=now)
    return Response(status=204, headers=RESET_HEADERS)


def invalid_link():
    return ContractError(400, 'PASSWORD_RESET_INVALID', '링크가 만료됐거나 이미 사용됐어요. 새 링크를 요청해 주세요.')


@api_view(['POST'])
@authentication_classes([])
@throttle_classes([ResetThrottle])
def confirm_reset(request):
    require_enabled()
    token = request.data.get('token')
    match = TOKEN.fullmatch(token) if isinstance(token, str) else None
    if not match or not constant_time_compare(match[2], keyed_digest('link', match[1])):
        raise invalid_link()
    token_id = UUID(hex=match[1])
    candidate = PasswordResetDelivery.objects.filter(token_id=token_id, delivered=True,
                                                        expires_at__gt=timezone.now()).first()
    if not candidate or not candidate.account_id:
        raise invalid_link()
    password = request.data.get('password')
    validate_member_password(password)
    password_hash = make_password(password)
    with transaction.atomic():
        account = eligible_accounts().select_for_update().filter(pk=candidate.account_id).first()
        active = PasswordResetDelivery.objects.filter(pk=candidate.pk, delivered=True,
                                                         expires_at__gt=timezone.now()).exists()
        if not account or not active or keyed_digest('email', account.email.lower()) != candidate.email_key:
            raise invalid_link()
        account.password = password_hash
        account.save(update_fields=['password'])
        Session.objects.filter(account=account).delete()
        PasswordResetDelivery.objects.filter(account=account).delete()
    return Response(status=204, headers=RESET_HEADERS)


def send_reset_mail(email, link):
    context = {
        'introduction': 'ARTI 계정의 비밀번호 재설정 요청을 받았어요.',
        'action': '새 비밀번호 설정',
        'link': link,
        'host': urlsplit(link).netloc,
        'validity': (
            f'이 링크는 요청한 시점부터 {LINK_TTL // timedelta(minutes=1)}분 동안 한\u00a0번만 사용할 수 있어요. '
            '만료됐다면 ARTI 로그인 도움에서 새 링크를 요청해 주세요.'
        ),
        'ignore': '본인이 요청하지 않았다면 이 메일을 무시해 주세요.',
    }
    text = '\n\n'.join((context['introduction'], f"{context['action']}\n{link}",
                        context['validity'].replace('\u00a0', ' '), context['ignore']))
    return send_mail(
        '[ARTI] 비밀번호 재설정 링크', text, settings.ARTI_PASSWORD_RESET_FROM, [email],
        html_message=render_to_string('arti/email/password_reset.html', context),
    )


def deliver_pending(limit=20):
    if not reset_enabled():
        return 0
    PasswordResetDelivery.objects.filter(expires_at__lte=timezone.now()).delete()
    sent = 0
    for _ in range(limit):
        with transaction.atomic():
            now = timezone.now()
            delivery = (PasswordResetDelivery.objects.select_for_update(skip_locked=True)
                        .filter(processed_at__isnull=True, next_attempt_at__lte=now, expires_at__gt=now)
                        .order_by('next_attempt_at', 'pk').first())
            if not delivery:
                break
            account = eligible_accounts().filter(pk=delivery.account_id).first() if delivery.account_id else None
            if account and keyed_digest('email', account.email.lower()) == delivery.email_key:
                token_id = delivery.token_id.hex
                token = f'{token_id}.{keyed_digest("link", token_id)}'
                link = f'{settings.ARTI_PASSWORD_RESET_ORIGIN}/password/reset#{urlencode({"token": token})}'
                try:
                    delivery.delivered = send_reset_mail(account.email, link) == 1
                except (SMTPException, OSError):
                    logger.warning('Password reset delivery failed')
                if not delivery.delivered:
                    delivery.next_attempt_at = now + timedelta(minutes=2)
                    delivery.save(update_fields=['next_attempt_at'])
                    continue
                sent += 1
            delivery.processed_at = timezone.now()
            delivery.save(update_fields=['processed_at', 'delivered'])
    return sent
