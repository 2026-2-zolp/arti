"""Run one durable artwork analysis at a time outside the admin request."""
import logging
from collections.abc import Mapping
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import Throttled
from rest_framework.response import Response

from .authentication import IsAdmin
from .editing import STATES, get_locked, run_artwork_analysis
from .http import ContractError
from .models import Artwork, ArtworkAnalysisBatch, ArtworkAnalysisItem, EmotionJob, Exhibition

log = logging.getLogger(__name__)
ACTIVE = ('queued', 'running', 'emotion')
LEASE = timedelta(minutes=3)
MAX_ATTEMPTS = 5


def enabled():
    return settings.ARTI_BACKGROUND_BATCH_ANALYSIS


def active_batches(exhibition_id=None):
    batches = ArtworkAnalysisBatch.objects.filter(Exists(ArtworkAnalysisItem.objects.filter(
        batch_id=OuterRef('pk'), state__in=ACTIVE,
    )))
    return batches.filter(exhibition_id=exhibition_id) if exhibition_id else batches


def snapshot():
    if not enabled():
        return {'enabled': False, 'batches': []}
    batches = ArtworkAnalysisBatch.objects.annotate(active=Exists(ArtworkAnalysisItem.objects.filter(
        batch_id=OuterRef('pk'), state__in=ACTIVE,
    ))).order_by('-created_at', '-pk').prefetch_related('items')
    active = list(batches.filter(active=True))
    recent = list(batches.filter(active=False)[:5])
    related_runs = {batch.run_id for batch in (*active, *recent) if batch.run_id}
    current = active + list(batches.filter(active=False).filter(
        Q(pk__in=[batch.pk for batch in recent]) | Q(run_id__in=related_runs),
    ))
    return {'enabled': True, 'batches': [{
        'id': batch.pk, 'exhibitionId': batch.exhibition_id, 'exhibitionTitle': batch.exhibition_title,
        'runId': str(batch.run_id) if batch.run_id else None,
        'createdAt': batch.created_at.isoformat(), 'active': batch.active,
        'items': [{
            'artworkId': item.artwork_id, 'title': item.title, 'state': item.state,
            'reviewReady': item.review_ready, 'failures': item.failures,
        } for item in batch.items.all()],
    } for batch in current]}


def eligible(work):
    return work.review_status == 'approved' and bool(work.description.strip())


def candidate_works(exhibitions):
    return Artwork.objects.filter(exhibition_id__in=exhibitions, review_status='approved').only(
        'id', 'exhibition_id', 'title', 'description', 'source_version', *STATES.values(),
    ).order_by('exhibition_id', 'id')


def missing_fields(work):
    return [kind for kind, field in STATES.items() if getattr(work, field) != 'confirmed']


def analysis_targets(exhibitions):
    if not exhibitions:
        return []
    groups = {ex.pk: {'exhibitionId': ex.pk, 'exhibitionTitle': ex.title, 'items': []} for ex in exhibitions}
    for work in candidate_works(groups):
        fields = missing_fields(work)
        if eligible(work) and fields:
            groups[work.exhibition_id]['items'].append({'artworkId': work.pk, 'title': work.title, 'fields': fields})
    return [group for group in groups.values() if group['items']]


def scope(data):
    if not isinstance(data, Mapping):
        raise ContractError(400, 'VALIDATION_ERROR', '분석할 전시 범위를 확인해 주세요.')
    exhibition_id, all_exhibitions = data.get('exhibitionId'), data.get('scope')
    if all_exhibitions == 'all' and exhibition_id is None:
        return None
    if all_exhibitions is None and isinstance(exhibition_id, str) and 0 < len(exhibition_id) <= 64:
        return exhibition_id
    raise ContractError(400, 'VALIDATION_ERROR', '분석할 전시 범위를 확인해 주세요.')


def selected_fields(data, exhibition_id):
    selections = data.get('selections')
    # Older clients can still enroll an individual exhibition.
    if selections is None and exhibition_id is not None:
        return None
    if not isinstance(selections, list) or not selections:
        raise ContractError(400, 'VALIDATION_ERROR', '분석할 항목을 선택해 주세요.')
    selected = {}
    for entry in selections:
        artwork_id, fields = (entry.get('artworkId'), entry.get('fields')) if isinstance(entry, dict) else (None, None)
        if (not isinstance(artwork_id, str) or not 0 < len(artwork_id) <= 64 or artwork_id in selected
                or not isinstance(fields, list) or not fields
                or any(not isinstance(field, str) or field not in STATES for field in fields)):
            raise ContractError(400, 'VALIDATION_ERROR', '선택한 작품과 분석 항목을 확인해 주세요.')
        selected[artwork_id] = set(fields)
    return selected


@transaction.atomic
def enroll(exhibition_id, use_image, selected):
    exhibitions = ([get_locked(Exhibition, exhibition_id)] if exhibition_id else
                   list(Exhibition.objects.select_for_update().order_by('pk')))
    busy = set(active_batches(exhibition_id).values_list('exhibition_id', flat=True))
    available = {ex.pk: ex for ex in exhibitions if ex.pk not in busy}
    targets = {}
    works = candidate_works(available)
    if selected is not None:
        works = works.filter(pk__in=selected)
    for work in works:
        if not eligible(work):
            continue
        fields = [field for field in missing_fields(work) if selected is None or field in selected[work.pk]]
        if fields:
            targets.setdefault(work.exhibition_id, []).append((work, fields))
    if not targets and busy and (selected is None or candidate_works(busy).filter(pk__in=selected).exists()):
        return
    if not targets:
        raise ContractError(400, 'NO_ANALYSIS_TARGETS', '분석할 미확정 항목이 있는 검수 완료 작품이 없어요.')
    run_id = uuid4() if exhibition_id is None else None
    items = []
    for target_id, rows in targets.items():
        batch = ArtworkAnalysisBatch.objects.create(exhibition_id=target_id,
                                                    exhibition_title=available[target_id].title,
                                                    use_image=use_image, run_id=run_id)
        items.extend(ArtworkAnalysisItem(batch=batch, artwork_id=work.pk, title=work.title,
                                        source_version=work.source_version, fields=fields) for work, fields in rows)
    ArtworkAnalysisItem.objects.bulk_create(items)


@transaction.atomic
def retry_failed(batch_id, work_id):
    batch = ArtworkAnalysisBatch.objects.filter(pk=batch_id).first()
    if batch is None:
        raise ContractError(404, 'NOT_FOUND', '분석 작업을 찾을 수 없어요.')
    get_locked(Exhibition, batch.exhibition_id)
    if active_batches(batch.exhibition_id).exclude(pk=batch_id).exists():
        raise ContractError(409, 'ANALYSIS_BATCH_ACTIVE', '이 전시의 새 분석 작업이 이미 진행 중이에요.')
    failed = ArtworkAnalysisItem.objects.select_for_update().filter(batch=batch, state='failed')
    if work_id:
        failed = failed.filter(artwork_id=work_id)
    failed = list(failed)
    if not failed:
        return
    works = Artwork.objects.filter(exhibition_id=batch.exhibition_id).in_bulk([item.artwork_id for item in failed])
    now = timezone.now()
    for item in failed:
        work = works.get(item.artwork_id)
        if work is None or not eligible(work):
            continue
        same_source = work.source_version == item.source_version
        if same_source and 'analysis' not in item.failures:
            item.fields = [kind for kind in STATES if kind in item.failures]
        item.review_ready = item.review_ready and same_source
        item.source_version = work.source_version
        item.title = work.title
        item.state = 'queued'
        item.failures = {}
        item.due_at = now
        item.attempts = 0
        item.claim_id = item.emotion_job_id = None
        item.save()
    if all(item.state == 'failed' for item in failed):
        raise ContractError(409, 'ANALYSIS_NEEDS_REVIEW', '작품의 원문과 검수 상태를 확인한 뒤 다시 시도해 주세요.')


@api_view(['GET', 'POST'])
@permission_classes([IsAdmin])
def batches(request):
    if request.method == 'POST':
        if not enabled():
            raise ContractError(503, 'FEATURE_DISABLED', '일괄 분석을 사용할 수 없어요.')
        exhibition_id = scope(request.data)
        use_image = request.data.get('useImage', True)
        if type(use_image) is not bool:
            raise ContractError(400, 'VALIDATION_ERROR', '도판 분석 여부를 확인해 주세요.')
        enroll(exhibition_id, use_image, selected_fields(request.data, exhibition_id))
    return Response(snapshot(), status=202 if request.method == 'POST' else 200,
                    headers={'Cache-Control': 'no-store'})


@api_view(['POST'])
@permission_classes([IsAdmin])
def retry(request, batch_id):
    if not enabled():
        raise ContractError(503, 'FEATURE_DISABLED', '일괄 분석을 사용할 수 없어요.')
    work_id = request.data.get('artworkId')
    if work_id is not None and (not isinstance(work_id, str) or not work_id or len(work_id) > 64):
        raise ContractError(400, 'VALIDATION_ERROR', '작품을 확인해 주세요.')
    retry_failed(batch_id, work_id)
    return Response(snapshot(), status=202, headers={'Cache-Control': 'no-store'})


@api_view(['POST'])
@permission_classes([IsAdmin])
def retry_run(request, run_id):
    if not enabled():
        raise ContractError(503, 'FEATURE_DISABLED', '일괄 분석을 사용할 수 없어요.')
    batches = ArtworkAnalysisBatch.objects.filter(run_id=run_id)
    if not batches.exists():
        raise ContractError(404, 'NOT_FOUND', '분석 작업을 찾을 수 없어요.')
    failed = batches.filter(Exists(ArtworkAnalysisItem.objects.filter(batch_id=OuterRef('pk'), state='failed')))
    registered, conflict = False, None
    for batch_id in failed.values_list('pk', flat=True):
        try:
            retry_failed(batch_id, None)
            registered = True
        except ContractError as error:
            if error.status_code not in (404, 409):
                raise
            conflict = error
    if conflict and not registered:
        raise conflict
    return Response(snapshot(), status=202, headers={'Cache-Control': 'no-store'})


@api_view(['GET'])
@permission_classes([IsAdmin])
def targets(request):
    if not enabled():
        raise ContractError(503, 'FEATURE_DISABLED', '일괄 분석을 사용할 수 없어요.')
    exhibition_id = scope(request.query_params)
    exhibitions = Exhibition.objects.exclude(pk__in=active_batches().values('exhibition_id')).order_by('pk')
    if exhibition_id is not None:
        exhibitions = exhibitions.filter(pk=exhibition_id)
    return Response({'exhibitions': analysis_targets(list(exhibitions))}, headers={'Cache-Control': 'no-store'})


@api_view(['POST'])
@permission_classes([IsAdmin])
def cancel(request, batch_id=None, run_id=None):
    if not enabled():
        raise ContractError(503, 'FEATURE_DISABLED', '일괄 분석을 사용할 수 없어요.')
    batches = ArtworkAnalysisBatch.objects.filter(run_id=run_id) if run_id else ArtworkAnalysisBatch.objects.filter(pk=batch_id)
    if not batches.exists():
        raise ContractError(404, 'NOT_FOUND', '분석 작업을 찾을 수 없어요.')
    ArtworkAnalysisItem.objects.filter(batch__in=batches, state__in=ACTIVE).update(
        state='canceled', claim_id=None, failures={},
    )
    return Response(snapshot(), headers={'Cache-Control': 'no-store'})


@transaction.atomic
def claim():
    now = timezone.now()
    queue = ArtworkAnalysisItem.objects.filter(state__in=('queued', 'running'), due_at__lte=now)
    queue.filter(attempts__gte=MAX_ATTEMPTS).update(state='failed', claim_id=None, failures={'analysis': 'AI_TIMEOUT'})
    item = queue.select_for_update(skip_locked=True).order_by('due_at', 'id').first()
    if item is not None:
        item.state = 'running'
        item.due_at = now + LEASE
        item.claim_id = uuid4()
        item.attempts += 1
        item.save(update_fields=['state', 'due_at', 'claim_id', 'attempts'])
    return item


def lease(item):
    return ArtworkAnalysisItem.objects.filter(pk=item.pk, claim_id=item.claim_id, state='running',
                                              due_at__gt=timezone.now())


def lease_lost():
    return ContractError(409, 'ANALYSIS_LEASE_LOST', '분석 작업이 취소됐거나 다른 워커에서 처리하고 있어요.')


def assert_active(item):
    if not lease(item).exists():
        raise lease_lost()


@transaction.atomic
def record(item, result):
    current = lease(item).select_for_update().first()
    if current is None:
        # Roll back any proposals written by a worker that lost this item's lease.
        raise lease_lost()
    current.review_ready = current.review_ready or any(result[kind]['made'] for kind in STATES)
    current.failures = {kind: result[kind].get('code', 'PROVIDER_ERROR') for kind in STATES if not result[kind]['ok']}
    current.state = 'failed' if current.failures else 'completed'
    job = result.get('emotionJob')
    if job and job['state'] == 'ready':
        current.review_ready = True
    elif job:
        current.emotion_job_id = job['id']
        current.state = 'emotion'
        current.due_at = timezone.now()
    current.claim_id = None
    current.save()


@transaction.atomic
def sync_emotion():
    now = timezone.now()
    item = (ArtworkAnalysisItem.objects.select_for_update(skip_locked=True)
            .filter(state='emotion', due_at__lte=now).order_by('due_at', 'id').first())
    if item is None:
        return False
    work = Artwork.objects.filter(pk=item.artwork_id).first()
    job = EmotionJob.objects.filter(pk=item.artwork_id, job_id=item.emotion_job_id).first()
    if not work or work.source_version != item.source_version or not eligible(work):
        item.review_ready = False
        item.failures['emotion'] = 'VERSION_CONFLICT'
    elif not job or job.state == 'stale':
        item.failures['emotion'] = 'VERSION_CONFLICT'
    elif job.state in ('queued', 'running'):
        item.due_at = now + timedelta(seconds=2)
        item.save(update_fields=['due_at'])
        return True
    elif job.state == 'ready':
        item.review_ready = True
    else:
        item.failures['emotion'] = job.error_code or 'PROVIDER_ERROR'
    item.state = 'failed' if item.failures else 'completed'
    item.save(update_fields=['state', 'review_ready', 'failures'])
    return True


def process_next():
    if not enabled():
        return False
    synced = sync_emotion()
    item = claim()
    if item is None:
        return synced
    try:
        batch = item.batch
        work = Artwork.objects.filter(pk=item.artwork_id, exhibition_id=batch.exhibition_id).first()
        if work is None or not eligible(work) or work.source_version != item.source_version:
            raise ContractError(409, 'VERSION_CONFLICT', '원문이나 검수 상태가 변경됐어요.')
        run_artwork_analysis(work, batch.use_image, item.fields, record=lambda result: record(item, result),
                             batch_item_id=item.pk, assert_active=lambda: assert_active(item))
    except Throttled:
        if item.attempts < MAX_ATTEMPTS:
            lease(item).update(state='queued', claim_id=None, due_at=timezone.now() + timedelta(seconds=4))
        else:
            lease(item).update(state='failed', claim_id=None, failures={'analysis': 'RATE_LIMITED'})
    except ContractError as error:
        lease(item).update(state='failed', claim_id=None, failures={'analysis': error.contract_code})
    except Exception as error:
        log.error('Artwork analysis worker failed item=%s type=%s', item.pk, type(error).__name__)
        lease(item).update(state='failed', claim_id=None, failures={'analysis': 'INTERNAL_ERROR'})
    return True
