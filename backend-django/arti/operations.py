import logging
from zoneinfo import ZoneInfo

from django.db import DatabaseError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .authentication import IsAdmin
from .models import OperationEvent
from .providers import configuration_status, draft_configuration_status
from .llm import DRAFT_TASKS, luna_image_route

logger = logging.getLogger(__name__)

ADMIN_ACTIONS = {
    'api/admin/exhibitions': 'exhibition_save',
    'api/admin/exhibitions/<str:ex_id>': 'exhibition_save',
    'api/admin/artworks': 'artwork_save',
    'api/admin/artworks/<str:artwork_id>': 'artwork_save',
    'api/admin/artworks/<str:artwork_id>/image': 'artwork_image',
    'api/admin/exhibitions/<str:ex_id>/floor-plan': 'floor_plan',
    'api/admin/exhibitions/<str:ex_id>/navigation': 'navigation_layout',
    'api/admin/artworks/<str:artwork_id>/analyze': 'artwork_analysis',
    'api/admin/artworks/<str:artwork_id>/discard-ai': 'discard_proposal',
    'api/admin/exhibitions/<str:ex_id>/confirm-ai': 'confirm_proposals',
}
VISITOR_ACTIONS = {
    'api/artworks/<str:artwork_id>/ask': 'docent_question',
    'api/artworks/<str:artwork_id>/explanation': 'docent_explanation',
    'api/visits/interpret': 'receipt_interpretation',
}
AI_ACTIONS = (*VISITOR_ACTIONS.values(), 'artwork_analysis')
PARTIAL_ANALYSIS = Q(action='artwork_analysis', status=200) & ~Q(analysis_failures=[])
ANALYSIS_CODES = {'AI_UNAVAILABLE', 'AI_TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR',
                  'VALIDATION_ERROR', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA'}


def partial_analysis_failures(response):
    if response.status_code != 200 or not isinstance(getattr(response, 'data', None), dict):
        return []
    failures = []
    for field in ('summary', 'guide', 'tag', 'emotion'):
        part = response.data.get(field)
        if not isinstance(part, dict) or part.get('ok') is not False:
            continue
        code = part.get('code')
        if code == 'AI_UNAVAILABLE':
            state = (draft_configuration_status() if field in DRAFT_TASKS
                     else configuration_status()['analysis'])
            if state == 'disabled':
                continue
        failures.append({'field': field, 'code': code if isinstance(code, str) and code in ANALYSIS_CODES else 'ANALYSIS_ERROR'})
    return failures


class OperationEventMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.method not in ('POST', 'PUT', 'DELETE'):
            return response

        route = getattr(request.resolver_match, 'route', None)
        action = ADMIN_ACTIONS.get(route)
        if action and getattr(getattr(request, 'user', None), 'role', None) != 'admin':
            return response
        if request.method == 'POST' and response.status_code in (200, 429, 500, 502, 503, 504):
            action = action or VISITOR_ACTIONS.get(route)
        if action and response.status_code != 405:
            try:
                with transaction.atomic():
                    failures = partial_analysis_failures(response) if action == 'artwork_analysis' else []
                    OperationEvent.objects.create(action=action, status=response.status_code,
                                                  request_id=request.request_id, analysis_failures=failures)
            except DatabaseError:
                # 원래 요청은 완료됐습니다. 기록 장애를 쓰기 실패로 돌려보내지 않습니다.
                logger.warning('Operation log unavailable requestId=%s', request.request_id)
        return response


@api_view(['GET'])
@permission_classes([IsAdmin])
def dashboard(request):
    midnight = timezone.localtime(timezone.now(), ZoneInfo('Asia/Seoul')).replace(hour=0, minute=0, second=0, microsecond=0)
    events = OperationEvent.objects.filter(occurred_at__gte=midnight)
    counts = events.aggregate(
        docentRequests=Count('id', filter=Q(action='docent_question')),
        analysisRequests=Count('id', filter=Q(action='artwork_analysis')),
        aiErrors=Count('id', filter=Q(action__in=AI_ACTIONS, status__gte=400)),
        analysisPartialFailures=Count('id', filter=PARTIAL_ANALYSIS),
    )
    recent = OperationEvent.objects.order_by('-occurred_at', '-pk')
    if request.query_params.get('errors') == '1':
        recent = recent.filter(Q(status__gte=400) | PARTIAL_ANALYSIS)
    rows = [] if request.query_params.get('summary') == '1' else recent[:50]
    return Response({
        'configuration': configuration_status(),
        'draftConfiguration': draft_configuration_status(),
        'draftImageTasks': [kind for kind in DRAFT_TASKS if luna_image_route(kind)],
        'today': counts,
        'recent': [
            {'requestId': str(event.request_id), 'occurredAt': event.occurred_at.isoformat(),
             'action': event.action, 'status': event.status,
             **({'analysisFailures': event.analysis_failures} if event.analysis_failures else {})}
            for event in rows
        ],
    }, headers={'Cache-Control': 'private, no-store'})
