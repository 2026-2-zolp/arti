import logging
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import DatabaseError, transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .authentication import IsAdmin
from .models import OperationEvent, OperationTextModelUsage, OperationVoiceModelUsage
from .model_usage import collect_model_usage
from .providers import configuration_status, draft_configuration_status
from .llm import DRAFT_TASKS, luna_image_route

logger = logging.getLogger(__name__)

ADMIN_ACTIONS = {
    'api/admin/ai-settings': 'ai_settings_save',
    'api/admin/exhibitions': 'exhibition_save',
    'api/admin/exhibitions/<str:ex_id>': 'exhibition_save',
    'api/admin/artworks': 'artwork_save',
    'api/admin/artworks/<str:artwork_id>': 'artwork_save',
    'api/admin/artworks/<str:artwork_id>/image': 'artwork_image',
    'api/admin/artworks/<str:artwork_id>/docent-collection': 'docent_source_review',
    'api/admin/exhibitions/<str:ex_id>/floor-plan': 'floor_plan',
    'api/admin/exhibitions/<str:ex_id>/poster': 'exhibition_poster',
    'api/admin/exhibitions/<str:ex_id>/navigation': 'navigation_layout',
    'api/admin/artworks/<str:artwork_id>/analyze': 'artwork_analysis',
    'api/admin/artworks/<str:artwork_id>/discard-ai': 'discard_proposal',
    'api/admin/exhibitions/<str:ex_id>/confirm-ai': 'confirm_proposals',
}
VISITOR_ACTIONS = {
    'api/artworks/<str:artwork_id>/ask': 'docent_question',
    'api/artworks/<str:artwork_id>/answer-audio': 'docent_audio',
    'api/artworks/<str:artwork_id>/explanation': 'docent_explanation',
    'api/visits/interpret': 'receipt_interpretation',
}
AI_ACTIONS = (*VISITOR_ACTIONS.values(), 'artwork_analysis')
PARTIAL_ANALYSIS = Q(action='artwork_analysis', status=200) & ~Q(analysis_failures=[])
ANALYSIS_CODES = {'AI_UNAVAILABLE', 'AI_TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'GUIDE_UNSUPPORTED',
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
        if request.method not in ('POST', 'PUT', 'DELETE'):
            return self.get_response(request)
        with collect_model_usage() as usage:
            response = self.get_response(request)

        route = getattr(request.resolver_match, 'route', None)
        action = ADMIN_ACTIONS.get(route)
        if action and getattr(getattr(request, 'user', None), 'role', None) != 'admin':
            return response
        if request.method == 'POST' and (usage.attempts or usage.voice is not None
                                         or response.status_code in (200, 429, 500, 502, 503, 504)):
            action = action or VISITOR_ACTIONS.get(route)
        if action and response.status_code != 405:
            try:
                with transaction.atomic():
                    failures = partial_analysis_failures(response) if action == 'artwork_analysis' else []
                    event = OperationEvent.objects.create(action=action, status=response.status_code,
                                                          request_id=request.request_id, analysis_failures=failures,
                                                          text_model_attempts=usage.attempts, text_model_measured=usage.measured,
                                                          text_model_input_tokens=usage.input_tokens,
                                                          text_model_output_tokens=usage.output_tokens)
                    if usage.by_task_model:
                        OperationTextModelUsage.objects.bulk_create([
                            OperationTextModelUsage(event=event, task=task, model=model,
                                                    attempts=count.attempts, measured=count.measured,
                                                    input_tokens=count.input_tokens, output_tokens=count.output_tokens,
                                                    cache_measured=count.cache_measured, cached_input_tokens=count.cached_input_tokens,
                                                    priced=count.priced, estimated_cost_usd=count.estimated_cost_usd)
                            for (task, model), count in usage.by_task_model.items()
                        ])
                    if usage.voice is not None:
                        voice = usage.voice
                        OperationVoiceModelUsage.objects.create(
                            event=event, intent=voice.intent, model=voice.model, input_tokens=voice.input_tokens,
                            output_tokens=voice.output_tokens, cached_input_tokens=voice.cached_input_tokens,
                            output_audio_tokens=voice.output_audio_tokens, estimated_cost_usd=voice.estimated_cost_usd,
                        )
            except DatabaseError:
                # 원래 요청은 완료됐습니다. 기록 장애를 쓰기 실패로 돌려보내지 않습니다.
                logger.warning('Operation log unavailable requestId=%s', request.request_id)
        return response


def text_model_usage_groups(events):
    groups = (OperationTextModelUsage.objects.filter(event__in=events).values('task', 'model')
              .annotate(total_attempts=Sum('attempts'), total_measured=Sum('measured'),
                        total_input=Sum('input_tokens'), total_output=Sum('output_tokens'),
                        total_cache_measured=Sum('cache_measured'), total_cached=Sum('cached_input_tokens'),
                        total_priced=Sum('priced'), total_cost=Sum('estimated_cost_usd'))
              .order_by('task', 'model'))
    return [{
        'task': row['task'], 'model': row['model'], 'attempts': row['total_attempts'],
        'missing': row['total_attempts'] - row['total_measured'],
        'inputTokens': row['total_input'] if row['total_measured'] else None,
        'outputTokens': row['total_output'] if row['total_measured'] else None,
        'cachedInputTokens': row['total_cached'] if row['total_cache_measured'] else None,
        'cacheMissing': row['total_attempts'] - row['total_cache_measured'],
        **({'priced': row['total_priced'], 'estimatedCostUsd': format(row['total_cost'], '.9f')}
           if row['total_priced'] else {}),
    } for row in groups]


def voice_model_usage_groups(events):
    groups = (
        OperationVoiceModelUsage.objects.filter(event__in=events).values('intent', 'model')
        .annotate(attempts=Count('pk'), measured=Count('pk', filter=Q(input_tokens__isnull=False, output_tokens__isnull=False)),
                  priced=Count('estimated_cost_usd'), inputTokens=Sum('input_tokens'), outputTokens=Sum('output_tokens'),
                  cachedInputTokens=Sum('cached_input_tokens'), outputAudioTokens=Sum('output_audio_tokens'),
                  estimatedCost=Sum('estimated_cost_usd'))
        .order_by('intent', 'model')
    )
    rows = []
    for group in groups:
        cost = group.pop('estimatedCost')
        rows.append({**group, 'estimatedCostUsd': format(cost, '.9f') if cost is not None else None})
    return rows


@api_view(['GET'])
@permission_classes([IsAdmin])
def dashboard(request):
    midnight = timezone.localtime(timezone.now(), ZoneInfo('Asia/Seoul')).replace(hour=0, minute=0, second=0, microsecond=0)
    events = OperationEvent.objects.filter(occurred_at__gte=midnight, occurred_at__lt=midnight + timedelta(days=1))
    counts = events.aggregate(
        docentRequests=Count('id', filter=Q(action='docent_question')),
        analysisRequests=Count('id', filter=Q(action='artwork_analysis')),
        aiErrors=Count('id', filter=Q(action__in=AI_ACTIONS, status__gte=400)),
        analysisPartialFailures=Count('id', filter=PARTIAL_ANALYSIS),
        attempts=Sum('text_model_attempts', default=0),
        measured=Sum('text_model_measured', default=0),
        inputTokens=Sum('text_model_input_tokens', default=0),
        outputTokens=Sum('text_model_output_tokens', default=0),
    )
    attempts, measured = counts.pop('attempts'), counts.pop('measured')
    input_tokens, output_tokens = counts.pop('inputTokens'), counts.pop('outputTokens')
    recent = OperationEvent.objects.order_by('-occurred_at', '-pk')
    if request.query_params.get('errors') == '1':
        recent = recent.filter(Q(status__gte=400) | PARTIAL_ANALYSIS)
    summary_only = request.query_params.get('summary') == '1'
    rows = [] if summary_only else recent[:50]
    return Response({
        'configuration': configuration_status(),
        'draftConfiguration': draft_configuration_status(),
        'draftImageTasks': [kind for kind in DRAFT_TASKS if luna_image_route(kind)],
        'today': counts,
        'textModelUsage': {'attempts': attempts, 'missing': attempts - measured,
                           'inputTokens': input_tokens if measured else None,
                           'outputTokens': output_tokens if measured else None},
        **({} if summary_only else {
            'textModelUsageByTaskModel': text_model_usage_groups(events),
            'voiceModelUsageByIntent': voice_model_usage_groups(events),
        }),
        'recent': [
            {'requestId': str(event.request_id), 'occurredAt': event.occurred_at.isoformat(),
             'action': event.action, 'status': event.status,
             **({'analysisFailures': event.analysis_failures} if event.analysis_failures else {})}
            for event in rows
        ],
    }, headers={'Cache-Control': 'private, no-store'})
