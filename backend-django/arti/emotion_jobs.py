"""Durable, version-bound background emotion analysis."""
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import budget, model_service, providers
from .http import ContractError
from .models import Artwork, ArtworkAnalysisItem, EmotionJob
from .serializers import artwork_dto

LEASE_SECONDS = 120
MAX_ATTEMPTS = 6
ACTIVE = ('queued', 'running')


def enabled():
    return settings.ARTI_BACKGROUND_EMOTION and bool(settings.ARTI_MODEL_SERVICE_URL)


def emotion_digest(work):
    return model_service.evidence_digest([work.emotion_status, work.analysis])


def analysis_identity(work, use_image, dt=None):
    prepared = model_service.analysis_input(dt if dt is not None else artwork_dto(work, True), use_image)
    fingerprint = model_service.evidence_digest([
        work.source_version, prepared[0]['title'], prepared[0]['description'], prepared[1],
        use_image, settings.ARTI_MODEL_SERVICE_URL, settings.ARTI_ANALYSIS_REVISION,
    ])
    return fingerprint, prepared


def canceled_batch(job, *, lock=False):
    if job.batch_item_id is None:
        return False
    items = ArtworkAnalysisItem.objects
    if lock:
        items = items.select_for_update()
    return items.filter(pk=job.batch_item_id).values_list('state', flat=True).first() == 'canceled'


def enqueue(work, use_image, batch_item_id=None):
    # The caller holds the artwork lock. Every transaction taking both locks uses the same order.
    fingerprint, _ = analysis_identity(work, use_image)
    job = EmotionJob.objects.select_for_update().filter(pk=work.pk).first()
    if job and job.fingerprint == fingerprint:
        if job.state == 'ready':
            return job
        if job.state in ACTIVE and not canceled_batch(job, lock=True):
            if batch_item_id is None and job.batch_item_id is not None:
                job.batch_item_id = None
                job.save(update_fields=['batch_item'])
            return job
    job, _ = EmotionJob.objects.update_or_create(artwork=work, defaults={
        'job_id': uuid4(), 'source_version': work.source_version,
        'fingerprint': fingerprint, 'emotion_before': emotion_digest(work), 'use_image': use_image,
        'state': 'queued', 'due_at': timezone.now(), 'attempts': 0, 'claim_id': None,
        'error_code': '', 'previous_version': None, 'result_version': None, 'batch_item_id': batch_item_id,
    })
    return job


def job_dto(job, work):
    if not job:
        return None
    state = job.state if work.source_version == job.source_version and work.review_status == 'approved' else 'stale'
    result = {
        'id': str(job.job_id), 'state': state, 'sourceVersion': job.source_version,
        'useImage': job.use_image, 'code': job.error_code, 'resultVersion': job.result_version,
    }
    if state == 'ready' and work.version == job.result_version:
        result['previousVersion'] = job.previous_version
        result['completed'] = {
            'analysis': work.analysis, 'emotionStatus': work.emotion_status, 'version': work.version,
            'contentVersion': work.content_version, 'updatedAt': work.updated_at.isoformat(),
        }
    return result


def claim():
    with transaction.atomic():
        now = timezone.now()
        job = (EmotionJob.objects.select_for_update(skip_locked=True)
               .filter(state__in=ACTIVE, due_at__lte=now).order_by('due_at', 'pk').first())
        if job is None:
            return None
        if job.attempts >= MAX_ATTEMPTS:
            job.state = 'failed'
            job.error_code = 'AI_TIMEOUT'
            job.claim_id = None
            job.save(update_fields=['state', 'error_code', 'claim_id'])
            return None
        job.state = 'running'
        job.due_at = now + timedelta(seconds=LEASE_SECONDS)
        job.attempts += 1
        job.claim_id = uuid4()
        job.save(update_fields=['state', 'due_at', 'attempts', 'claim_id'])
        return job


def job_input(job, work):
    if (work is None or work.review_status != 'approved' or work.source_version != job.source_version
            or emotion_digest(work) != job.emotion_before):
        return None
    snapshot = artwork_dto(work, True)
    try:
        fingerprint, prepared = analysis_identity(work, job.use_image, snapshot)
    except ContractError:
        return None
    return (snapshot, prepared) if fingerprint == job.fingerprint else None


def complete(job, value=None, error=None):
    from .editing import analysis_write, before, finish

    # A failed/abandoned lease and a replaced job cannot publish even if a model call later returns.
    with analysis_write():
        work = Artwork.objects.select_for_update().filter(pk=job.pk).first()
        current = EmotionJob.objects.select_for_update().filter(
            pk=job.pk, job_id=job.job_id, claim_id=job.claim_id, state='running',
            due_at__gt=timezone.now(),
        ).first()
        if current is None:
            return
        current.claim_id = None
        if canceled_batch(current, lock=True) or job_input(current, work) is None:
            current.state = 'stale'
        elif error is not None:
            current.error_code = error.contract_code
            if error.status_code in (429, 503) and current.attempts < MAX_ATTEMPTS:
                current.state = 'queued'
                current.due_at = timezone.now() + timedelta(seconds=min(30, 5 * current.attempts))
            else:
                current.state = 'failed'
        elif value is not None:
            old = before(work)
            old['public_dto'] = artwork_dto(work)
            current.previous_version = work.version
            analysis = work.analysis if isinstance(work.analysis, dict) else {}
            previous = {key: analysis[key] for key in ('tagSource', 'tags') if key in analysis}
            work.analysis = {**previous, **value, 'analyzedAt': timezone.now().isoformat()}
            work.emotion_status = 'suggested'
            finish(work, old)
            current.result_version = work.version
            current.state = 'ready'
            current.error_code = ''
        else:
            current.state = 'stale'
        current.save()


def process_next():
    if not enabled() or (job := claim()) is None:
        return False
    work = Artwork.objects.filter(pk=job.pk).first()
    inputs = job_input(job, work)
    if inputs is None or canceled_batch(job):
        complete(job)
        return True
    snapshot, prepared = inputs
    value, error = None, None
    try:
        deadline = budget.monotonic() + model_service.EMOTION_TIMEOUT_SECONDS
        value = model_service.analyze(snapshot, use_image=job.use_image, prepared=prepared,
                                      stage='emotion', deadline=deadline)
        providers.validate('emotion', value)
    except ContractError as exc:
        error = exc
    complete(job, value, error)
    return True
