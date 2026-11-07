import logging
import uuid
from django.http import JsonResponse
from rest_framework.exceptions import APIException

log = logging.getLogger(__name__)


class ContractError(APIException):
    def __init__(self, status, code, message, retryable=False):
        self.status_code = status
        self.contract_code = code
        self.retryable = retryable
        super().__init__(message)


def error_body(status, message, request_id, code=None, retryable=False):
    codes = {400: 'VALIDATION_ERROR', 401: 'AUTH_REQUIRED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
             405: 'METHOD_NOT_ALLOWED', 415: 'UNSUPPORTED_MEDIA', 429: 'RATE_LIMITED', 501: 'FEATURE_DISABLED'}
    return {'error': message, 'code': code or codes.get(status, 'INTERNAL_ERROR'),
            'retryable': retryable, 'requestId': request_id}


def exception_handler(exc, context):
    from rest_framework.views import exception_handler as drf_exception_handler
    request_id = getattr(context['request'], 'request_id', 'unknown')
    response = drf_exception_handler(exc, context)
    if response is None:
        log.error('Unhandled API failure requestId=%s type=%s', request_id, type(exc).__name__)
        return JsonResponse(error_body(500, '서버에서 문제가 발생했어요.', request_id, retryable=True), status=500)
    message = '요청을 처리할 수 없어요.'
    detail = getattr(exc, 'detail', None)
    if isinstance(detail, str):
        message = str(detail)
    elif response.status_code == 400:
        message = '입력값을 확인해 주세요.'
    response.data = error_body(response.status_code, message, request_id,
                               getattr(exc, 'contract_code', None), getattr(exc, 'retryable', False))
    if isinstance(detail, (dict, list)):
        response.data['fieldErrors'] = detail
    return response


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid.uuid4())
        response = self.get_response(request)
        response['X-Request-Id'] = request.request_id
        return response


def not_found(request, exception=None):
    return JsonResponse(error_body(404, '존재하지 않는 API예요.', getattr(request, 'request_id', 'unknown')), status=404)
