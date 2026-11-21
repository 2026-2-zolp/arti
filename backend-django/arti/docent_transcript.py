"""Keep consented successful turns in the member's own visit scope."""
from uuid import UUID

from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .http import ContractError
from .models import DocentTranscript, DocentTranscriptConsent, VisitReaction
from .taste_resolution import locked_actor, taste_transaction


DOCENT_TRANSCRIPT_NOTICE_VERSION = '2026-11-21.1'
PRIVATE = {'Cache-Control': 'private, no-store'}


def transcript_storage_enabled():
    return settings.ARTI_DOCENT_TRANSCRIPTS_ENABLED


def grant_transcript_consent(account):
    consent, _ = DocentTranscriptConsent.objects.get_or_create(
        account=account, defaults={'version': DOCENT_TRANSCRIPT_NOTICE_VERSION},
    )
    if consent.version != DOCENT_TRANSCRIPT_NOTICE_VERSION:
        consent.version = DOCENT_TRANSCRIPT_NOTICE_VERSION
        consent.consented_at = timezone.now()
        consent.save(update_fields=['version', 'consented_at'])
    return consent


def consent_revision(account):
    return (DocentTranscriptConsent.objects.filter(account=account, version=DOCENT_TRANSCRIPT_NOTICE_VERSION)
            .values_list('consented_at', 'revision').first())


def transcript_available_for(account):
    return (transcript_storage_enabled() or DocentTranscriptConsent.objects.filter(account=account).exists()
            or DocentTranscript.objects.filter(account=account).exists())


def turn_uuid(value):
    try:
        result = UUID(value)
    except (TypeError, ValueError, AttributeError):
        result = None
    if result is None or result.version != 4:
        raise ContractError(400, 'VALIDATION_ERROR', '대화 식별자를 확인해 주세요.')
    return result


def save_successful_turn(request, work, visit_id, turn_id, question, answer, consent_at_request):
    if consent_at_request is None:
        return
    with taste_transaction():
        actor = locked_actor(request)
        if consent_revision(actor) != consent_at_request:
            return
        conversation, _ = DocentTranscript.objects.get_or_create(account=actor, artwork=work, visit_id=visit_id)
        key = str(turn_id)
        if conversation.deleted or any(turn['id'] == key for turn in conversation.turns):
            return
        conversation.turns.append({'id': key, 'question': question, 'answer': answer})
        conversation.save(update_fields=['turns'])


def liked_conversations(account, work):
    liked = VisitReaction.objects.filter(visit__user=account, artwork=work, reaction='like').select_related('visit')
    rows = DocentTranscript.objects.filter(
        account=account, artwork=work, deleted=False, visit_id__in=liked.values('visit__visit_id'),
    )
    by_visit = {row.visit_id: row for row in rows}
    return [
        {'visitId': str(item.visit.visit_id), 'likedAt': item.visit.canonical_payload['date'],
         'turns': by_visit[item.visit.visit_id].turns}
        for item in liked.order_by('-visit__canonical_payload__date', '-visit__created_at', '-visit_id')
        if item.visit.visit_id in by_visit
    ]


@api_view(['DELETE'])
def delete_liked_conversation(request, artwork_id, visit_id):
    from .member import member

    member(request)
    with taste_transaction():
        actor = locked_actor(request)
        if not VisitReaction.objects.filter(
            visit__user=actor, visit__visit_id=visit_id, artwork_id=artwork_id, reaction='like',
        ).exists():
            raise ContractError(404, 'NOT_FOUND', '좋아요한 작품 기록이 없어요.')
        DocentTranscript.objects.update_or_create(
            account=actor, artwork_id=artwork_id, visit_id=visit_id, defaults={'turns': [], 'deleted': True},
        )
    return Response(status=204, headers=PRIVATE)


@api_view(['GET', 'PATCH', 'DELETE'])
def transcript_settings(request, user_id):
    from .member import member

    actor = member(request, user_id)
    if request.method == 'GET':
        return Response({
            'available': transcript_available_for(actor), 'storageAvailable': transcript_storage_enabled(),
            'enabled': consent_revision(actor) is not None, 'noticeVersion': DOCENT_TRANSCRIPT_NOTICE_VERSION,
            'hasConversations': DocentTranscript.objects.filter(account=actor, deleted=False).exists(),
        }, headers=PRIVATE)
    body = request.data
    if request.method == 'PATCH' and (not isinstance(body, dict) or not (
        body == {'enabled': False} or body == {'enabled': True, 'noticeVersion': DOCENT_TRANSCRIPT_NOTICE_VERSION}
    ) or type(body['enabled']) is not bool):
        raise ContractError(400, 'VALIDATION_ERROR', '대화 저장 동의를 확인해 주세요.')
    with taste_transaction():
        actor = locked_actor(request)
        if request.method == 'DELETE':
            consent = DocentTranscriptConsent.objects.filter(account=actor).first()
            if consent:
                consent.revision += 1
                consent.save(update_fields=['revision'])
            DocentTranscript.objects.filter(account=actor, deleted=False).update(turns=[], deleted=True)
        elif body['enabled']:
            if not transcript_storage_enabled():
                raise ContractError(404, 'NOT_FOUND', '대화 저장을 지금 이용할 수 없어요.')
            grant_transcript_consent(actor)
        else:
            DocentTranscriptConsent.objects.filter(account=actor).delete()
    return Response(status=204, headers=PRIVATE)
