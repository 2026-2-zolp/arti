# 버전 충돌을 확인하며 관리자 편집·이미지·도면·검수를 저장합니다.
"""Versioned administrator edits; generated values are never client-owned."""
import re
import secrets
from pathlib import Path
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import transaction, connection, OperationalError
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from contextlib import contextmanager
from urllib.parse import urlsplit
from rest_framework.decorators import api_view, permission_classes, parser_classes, throttle_classes
from rest_framework.parsers import BaseParser
from rest_framework.response import Response
from .authentication import IsAdmin
from .http import ContractError
from .models import Artwork, DocentTranscript, Exhibition, Visit, VisitReaction
from .serializers import RETAINED_TEXT_FIELDS, artwork_dto, exhibition_dto
from .taste_resolution import taste_transaction
from .views import with_etag
from . import providers
from .docent import AIThrottle
from . import budget
from .indoor import normalize_layout

FIELDS = {'title':'title', 'artist':'artist', 'year':'year', 'exhibitionId':'exhibition_id', 'roomId':'room_id',
          'palette':'palette', 'imageUrl':'image_url', 'showImage':'show_image', 'tags':'tags', 'description':'description',
          'guidedLooking':'guided_looking', 'guidedHints':'guided_hints', 'guideIntro':'guide_intro',
          'source':'source', 'referenceUrl':'reference_url', 'reviewStatus':'review_status',
          'summary':'summary', 'summaryKeywords':'summary_keywords', 'summaryStatus':'summary_status',
          'guideStatus':'guide_status', 'tagStatus':'tag_status', 'emotionStatus':'emotion_status'}
SOURCE = {'title','artist','year','description','source','reference_url','image_url','image_file','exhibition_id'}
STATES = {'summary':'summary_status','guide':'guide_status','tag':'tag_status','emotion':'emotion_status'}


def fail(message='입력값을 확인해 주세요.'):
    raise ContractError(400, 'VALIDATION_ERROR', message)


def get_locked(model, pk):
    obj = model.objects.select_for_update().filter(pk=pk).first()
    if not obj:
        raise ContractError(404, 'NOT_FOUND', '자료를 찾을 수 없어요.')
    return obj


def version(obj, value):
    if type(value) is not int or value < 1:
        fail('현재 version을 함께 보내 주세요.')
    if obj.version != value:
        raise ContractError(409, 'VERSION_CONFLICT', '다른 수정이 먼저 저장됐어요. 새로 조회해 주세요.')


def match_version(request, obj):
    match = re.fullmatch(r'"([1-9][0-9]{0,9})"', request.headers.get('If-Match', ''))
    if not match:
        fail('If-Match에 현재 version을 보내 주세요.')
    version(obj, int(match[1]))


def deletion_blocked(message):
    raise ContractError(409, 'DELETE_BLOCKED', message)


def delete_artwork(request, artwork_id):
    with taste_transaction():
        exhibition_id = Artwork.objects.filter(pk=artwork_id).values_list('exhibition_id', flat=True).first()
        if exhibition_id is None:
            raise ContractError(404, 'NOT_FOUND', '작품을 찾을 수 없어요.')
        # Match floor-plan edits and direct-order changes by locking the exhibition first.
        exhibition = get_locked(Exhibition, exhibition_id)
        work = get_locked(Artwork, artwork_id)
        match_version(request, work)
        if work.review_status == 'approved':
            deletion_blocked('검수 완료된 작품이에요. 검수 상태를 변경해 저장한 뒤 삭제해 주세요.')
        if artwork_id in exhibition.direct_visit_order:
            deletion_blocked('위치·지도 관리에서 이 작품을 전시 관람 순서에서 먼저 빼 주세요.')
        if work.survey_entries.exists():
            deletion_blocked('취향 조사에 연결된 작품이에요. 조사 작품 연결을 먼저 해제해 주세요.')
        has_receipt = Visit.objects.filter(
            Q(canonical_payload__viewedArtworkIds__contains=[artwork_id])
            | Q(artwork_snapshots__contains=[{'id': artwork_id}]),
        ).exists()
        if (has_receipt or VisitReaction.objects.filter(artwork=work).exists()
                or DocentTranscript.objects.filter(artwork=work).exists()):
            deletion_blocked('연결된 관람 기록이나 도슨트 대화를 보존해야 해서 작품을 삭제할 수 없어요.')
        try:
            work.delete()
        except ProtectedError:
            deletion_blocked('연결된 자료가 생겼어요. 목록을 갱신해 다시 확인해 주세요.')
    return Response(status=204)


def delete_exhibition(request, ex_id):
    with taste_transaction():
        exhibition = get_locked(Exhibition, ex_id)
        match_version(request, exhibition)
        if exhibition.status == 'running':
            deletion_blocked('운영 중인 전시예요. 운영 상태를 변경해 저장한 뒤 삭제해 주세요.')
        if Visit.objects.filter(exhibition=exhibition).exists():
            deletion_blocked('관람 기록이 남아 있어요. 전시를 종료 상태로 보관해 주세요.')
        if exhibition.artworks.exists():
            deletion_blocked('전시에 연결된 작품을 먼저 다른 전시로 옮기거나 삭제해 주세요.')
        try:
            exhibition.delete()
        except ProtectedError:
            deletion_blocked('연결된 작품이나 관람 기록이 생겼어요. 목록을 갱신해 다시 확인해 주세요.')
    return Response(status=204)


def validate_save(obj):
    try:
        obj.full_clean()
    except (ValidationError, TypeError, ValueError, KeyError, AttributeError):
        fail()
    obj.save()


def stale(w):
    w.source_version += 1
    w.review_status = 'source_check'
    for field in STATES.values():
        if getattr(w, field) == 'confirmed':
            setattr(w, field, 'suggested')


def finish(w, old, *, discarded_text=None):
    if any(getattr(w, f) != old[f] for f in SOURCE):
        stale(w)
    w.retained_text = {
        kind: snapshot for kind, snapshot in w.retained_text.items()
        if w.review_status == 'approved' and getattr(w, STATES[kind]) == 'suggested'
    }
    if w.summary != old['summary'] or w.summary_status != old['summary_status']:
        w.summary_revision += 1
    if any(getattr(w, f) != old[f] for f in ('guide_intro','guided_looking','guided_hints','guide_status')):
        w.guide_revision += 1
    w.version += 1
    public_before = old.get('public_dto')
    if discarded_text:
        # Restoring the same public text keeps existing docent references valid.
        setattr(w, f'{discarded_text}_revision', public_before[f'{discarded_text}Revision'])
    if public_before is None or any(
        value != public_before[key]
        for key, value in artwork_dto(w).items()
        if key not in ('version', 'updatedAt')
    ):
        w.content_version += 1
    validate_save(w)


def before(w):
    import copy
    return {f:copy.deepcopy(getattr(w,f)) for f in SOURCE | {'summary','summary_status','guide_intro','guided_looking','guided_hints','guide_status'}}


@api_view(['GET','POST','PUT','DELETE'])
@permission_classes([IsAdmin])
def artworks(request, artwork_id=None):
    if request.method == 'DELETE':
        if not artwork_id:
            raise ContractError(405, 'METHOD_NOT_ALLOWED', '삭제할 작품을 지정해 주세요.')
        return delete_artwork(request, artwork_id)
    if request.method == 'GET':
        # The original read DTO is shared; do not invoke a decorated view recursively.
        query = Artwork.objects.all()
        if artwork_id:
            w = query.filter(pk=artwork_id).first()
            if not w: raise ContractError(404,'NOT_FOUND','작품을 찾을 수 없어요.')
            return with_etag(artwork_dto(w, True))
        if 'exhibitionId' in request.query_params: query=query.filter(exhibition_id=request.query_params['exhibitionId'])
        return Response([artwork_dto(w, True) for w in query])
    if (request.method == 'PUT') != bool(artwork_id): fail()
    data=request.data
    required={'exhibitionId','title','artist','year','roomId','position','palette','imageUrl','showImage','tags','description',
              'guidedLooking','guidedHints','guideIntro','source','referenceUrl','reviewStatus','summary','summaryKeywords',
              'summaryStatus','guideStatus','tagStatus','emotionStatus'}
    if not required.issubset(data): fail('편집 필수 필드가 누락됐어요. 새로 조회해 주세요.')
    for key in required - {'position','palette','showImage','tags','guidedLooking','guidedHints','summaryKeywords'}:
        if not isinstance(data[key],str):fail()
    if data['reviewStatus'] == 'approved' and (not data['source'].strip() or not data['description'].strip()):
        fail('검수 완료로 저장하려면 작품 해설과 출처가 있어야 해요.')
    if not isinstance(data['showImage'],bool): fail()
    for key in ['palette','tags','guidedLooking','guidedHints','summaryKeywords']:
        if not isinstance(data[key],list) or any(not isinstance(v,str) for v in data[key]) or len(data[key])>50: fail()
    for key in ['imageUrl','referenceUrl']:
        if data[key] and (not isinstance(data[key],str) or not re.match(r'^https?://[^\s]+$',data[key])): fail('이미지/출처 URL을 확인해 주세요.')
    with transaction.atomic():
        if 'mapVersion' in data:
            # Lock in the same order as a plan replacement. The work list may have arrived after the displayed map.
            ex = get_locked(Exhibition, data['exhibitionId'])
            version(ex, data['mapVersion'])
        w=get_locked(Artwork,artwork_id) if artwork_id else Artwork()
        if artwork_id: version(w,data.get('version'))
        if 'mapVersion' in data and artwork_id and w.exhibition_id != data['exhibitionId']:
            fail('현재 전시의 작품만 지도에 배치할 수 있어요.')
        old=before(w)
        for key,field in FIELDS.items(): setattr(w,field,data[key])
        point=data['position']
        if point is not None and (not isinstance(point,dict) or set(point)!={'x','y'} or any(type(point[k]) not in (int,float) for k in point)): fail()
        w.position_x=None if point is None else point['x'];w.position_y=None if point is None else point['y']
        if not Exhibition.objects.filter(pk=w.exhibition_id).exists(): fail('전시를 먼저 등록해 주세요.')
        if artwork_id: finish(w,old)
        else: validate_save(w)
        return with_etag(artwork_dto(w,True))


def collection_review(work):
    state = work.docent_collection
    return {'version': state.get('version', 0), 'sourceVersion': work.source_version,
            'draft': state.get('draft'), 'approved': work.approved_docent_collection,
            'canApprove': work.review_status == 'approved'}


@api_view(['GET', 'PUT', 'POST'])
@permission_classes([IsAdmin])
def docent_collection(request, artwork_id):
    headers = {'Cache-Control': 'no-store'}
    if request.method == 'GET':
        work = Artwork.objects.filter(pk=artwork_id).first()
        if work is None:
            raise ContractError(404, 'NOT_FOUND', '작품을 찾을 수 없어요.')
        return Response(collection_review(work), headers=headers)

    data = request.data
    if (not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] < 0
            or type(data.get('sourceVersion')) is not int or data['sourceVersion'] < 1):
        fail('보강 자료와 작품의 현재 버전을 함께 보내 주세요.')
    with transaction.atomic():
        work = get_locked(Artwork, artwork_id)
        state = work.docent_collection
        if data['version'] != state.get('version', 0) or data['sourceVersion'] != work.source_version:
            raise ContractError(409, 'VERSION_CONFLICT', '보강 자료나 작품이 먼저 수정됐어요. 최신 자료를 불러와 주세요.')
        next_version = data['version'] + 1
        if request.method == 'PUT':
            limits = {'url': 2000, 'accession': 100, 'excerpt': 1000}
            if any(not isinstance(data.get(key), str) or len(data[key]) > limit for key, limit in limits.items()):
                fail('소장처 URL, 소장번호와 근거 문장의 길이를 확인해 주세요.')
            draft = {key: data[key].strip() for key in limits}
            if not any(draft.values()):
                fail('보강할 내용을 입력해 주세요.')
            if draft['url']:
                try:
                    URLValidator(schemes=['https'])(draft['url'])
                    if urlsplit(draft['url']).username is not None:
                        raise ValidationError('Credentials are not allowed in a reference URL.')
                except (ValidationError, ValueError):
                    fail('소장처의 HTTPS 주소를 입력해 주세요.')
            state['draft'] = {**draft, 'sourceVersion': work.source_version}
        else:
            draft = state.get('draft')
            if work.review_status != 'approved':
                fail('작품 자체가 검수 완료 상태일 때 소장처 자료를 승인할 수 있어요.')
            if not draft or not all(draft[field] for field in ('url', 'accession', 'excerpt')):
                fail('소장처 URL·소장번호·근거 문장을 모두 적어 초안으로 저장해 주세요.')
            if draft['sourceVersion'] != work.source_version:
                raise ContractError(409, 'VERSION_CONFLICT', '작품 원문이 바뀌었어요. 보강 내용을 확인하고 다시 저장해 주세요.')
            state['approved'] = {**draft, 'revision': next_version}
            del state['draft']
        state['version'] = next_version
        work.save(update_fields=['docent_collection'])
        return Response(collection_review(work), headers=headers)


@api_view(['GET','POST','PUT','DELETE'])
@permission_classes([IsAdmin])
def exhibitions(request, ex_id=None):
    if request.method == 'DELETE':
        if not ex_id:
            raise ContractError(405, 'METHOD_NOT_ALLOWED', '삭제할 전시를 지정해 주세요.')
        return delete_exhibition(request, ex_id)
    if request.method=='GET':
        qs=Exhibition.objects.all()
        if ex_id:
            ex=qs.filter(pk=ex_id).first()
            if not ex: raise ContractError(404,'NOT_FOUND','전시를 찾을 수 없어요.')
            return with_etag(exhibition_dto(ex, admin=True))
        return Response([exhibition_dto(e, admin=True) for e in qs])
    if (request.method=='PUT')!=bool(ex_id): fail()
    data=request.data
    fields={'title':'title','subtitle':'subtitle','venue':'venue','startDate':'start_date','endDate':'end_date','status':'status','rooms':'rooms'}
    if not (set(fields)|{'entrance'}).issubset(data):fail('전시 편집 필수 필드를 확인해 주세요.')
    point=data['entrance']
    if not isinstance(point,dict) or set(point)!={'x','y'} or any(type(point[k]) not in (int,float) for k in point):fail()
    with transaction.atomic():
        ex=get_locked(Exhibition,ex_id) if ex_id else Exhibition()
        if ex_id:version(ex,data.get('version'))
        if 'directVisitOrder' in data:
            order = data['directVisitOrder']
            if (not isinstance(order, list) or len(order) > 200
                    or any(not isinstance(item, str) or not item or len(item) > 64 for item in order)
                    or len(set(order)) != len(order)):
                fail('관람 순서에는 작품을 최대 200점까지 한 번씩 등록해 주세요.')
            if order and (not ex_id or Artwork.objects.filter(exhibition=ex, pk__in=order).count() != len(order)):
                fail('이 전시의 작품만 관람 순서에 등록해 주세요.')
            ex.direct_visit_order = order
        for key,field in fields.items():setattr(ex,field,data[key])
        if not isinstance(ex.rooms,list):fail()
        if ex_id and Artwork.objects.filter(exhibition=ex).exclude(room_id='').exclude(room_id__in=[r.get('id') for r in ex.rooms if isinstance(r,dict)]).exists():
            fail('작품이 배정된 전시실을 먼저 변경해 주세요.')
        ex.entrance_x=point['x'];ex.entrance_y=point['y']
        if ex_id:ex.version+=1
        validate_save(ex)
        # Model clean coerces dates on full_clean.
        return with_etag(exhibition_dto(ex, admin=True))


@api_view(['PUT'])
@permission_classes([IsAdmin])
def navigation_layout(request, ex_id):
    data = request.data
    if not isinstance(data, dict) or 'layout' not in data or type(data.get('floorPlanRevision')) is not int:
        fail('도면 버전과 이동 구조를 함께 보내 주세요.')
    with transaction.atomic():
        ex = get_locked(Exhibition, ex_id)
        version(ex, data.get('version'))
        if data['floorPlanRevision'] != ex.floor_plan_revision:
            raise ContractError(409, 'VERSION_CONFLICT', '도면이 바뀌었어요. 새 도면을 다시 불러와 주세요.')
        ex.navigation_layout = normalize_layout(data['layout'], ex.floor_plan_revision)
        ex.version += 1
        validate_save(ex)
        return with_etag(exhibition_dto(ex, admin=True))


# 이미지 업로드 크기를 제한하며 원시 바이트를 읽습니다.
class RawImageParser(BaseParser):
    media_type='*/*'
    def parse(self,stream,media_type=None,parser_context=None):
        value=stream.read(10*1024*1024+1)
        if len(value)>10*1024*1024:raise ContractError(413,'PAYLOAD_TOO_LARGE','이미지는 10MiB 이내로 올려 주세요.')
        return value


def image_bytes(data, content_type):
    signatures={'image/png':data.startswith(b'\x89PNG\r\n\x1a\n'),'image/jpeg':data.startswith(b'\xff\xd8\xff'),
                'image/webp':len(data)>=12 and data[:4]==b'RIFF' and data[8:12]==b'WEBP'}
    if not signatures.get(content_type):raise ContractError(415,'UNSUPPORTED_MEDIA','PNG/JPEG/WEBP 이미지가 필요해요.')
    return {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[content_type]


@api_view(['POST','DELETE'])
@permission_classes([IsAdmin])
@parser_classes([RawImageParser])
def image(request, artwork_id=None, ex_id=None, poster=False):
    with transaction.atomic():
        obj=get_locked(Artwork,artwork_id) if artwork_id else get_locked(Exhibition,ex_id)
        match_version(request, obj)
        old=before(obj) if artwork_id else None
        filename=None
        if request.method=='POST':
            data=request.data
            ext=image_bytes(data,request.content_type)
            if ex_id and not poster:
                try:width=int(request.query_params['width']);height=int(request.query_params['height'])
                except (KeyError,ValueError):fail()
                if not 1<=width<=20000 or not 1<=height<=20000:fail()
            filename=secrets.token_hex(24)+'.'+ext
            root=Path(settings.MEDIA_ROOT);root.mkdir(parents=True,exist_ok=True)
            (root/filename).write_bytes(data)
        try:
            if artwork_id:
                obj.image_file=filename;finish(obj,old)
            elif poster:
                obj.poster_file = filename
                obj.version += 1
                validate_save(obj)
            else:
                obj.floor_plan={'file':filename,'width':width,'height':height} if filename else None
                obj.floor_plan_revision += 1
                obj.navigation_layout = None
                obj.version+=1;validate_save(obj)
                # A replaced plan cannot carry a previously checked coordinate forward.
                for w in Artwork.objects.select_for_update().filter(exhibition=obj):
                    w.position_x=w.position_y=None;w.version+=1;w.content_version+=1;w.save()
        except Exception:
            if filename:(Path(settings.MEDIA_ROOT)/filename).unlink(missing_ok=True)
            raise
        # Unlinked old files remain private, permitting deliberate later garbage collection.
        return with_etag(artwork_dto(obj,True) if artwork_id else exhibition_dto(obj, admin=True))


@api_view(['POST'])
@permission_classes([IsAdmin])
def confirm_ai(request, ex_id):
    items=request.data.get('items')
    if not isinstance(items,list) or not 1<=len(items)<=100:fail('검토한 작품과 필드를 선택해 주세요.')
    if any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in items):
        fail()
    if len({item['id'] for item in items}) != len(items):
        fail()
    with taste_transaction():
        works=[]
        for item in sorted(items, key=lambda item: item['id']):
            w=get_locked(Artwork,item.get('id'))
            if w.exhibition_id!=ex_id:fail('다른 전시의 작품이 포함됐어요.')
            version(w,item.get('version'))
            fields=item.get('fields')
            if not isinstance(fields,list) or not fields or any(f not in STATES for f in fields):fail()
            works.append((w,fields))
        for w,fields in works:
            old=before(w)
            for field in fields:setattr(w,STATES[field],'confirmed')
            finish(w,old)
    return Response({'confirmed':len(works)})


@api_view(['POST'])
@permission_classes([IsAdmin])
def discard_ai(request, artwork_id):
    kind = request.data.get('kind')
    if kind not in ('summary', 'guide'):
        fail('폐기할 요약이나 관람가이드 제안을 선택해 주세요.')
    status = STATES[kind]
    with transaction.atomic():
        work = get_locked(Artwork, artwork_id)
        version(work, request.data.get('version'))
        if getattr(work, status) != 'suggested':
            fail('폐기할 제안이 없어요.')
        old = before(work)
        public = artwork_dto(work)
        old['public_dto'] = public
        for field in RETAINED_TEXT_FIELDS[kind]:
            if field in FIELDS:
                setattr(work, FIELDS[field], public[field])
        setattr(work, status, public[f'{kind}Status'])
        finish(work, old, discarded_text=kind)
    return with_etag(artwork_dto(work, True))


@api_view(['POST'])
@permission_classes([IsAdmin])
@throttle_classes([AIThrottle])
def analyze(request,artwork_id):
    w=Artwork.objects.filter(pk=artwork_id).first()
    if not w:raise ContractError(404,'NOT_FOUND','작품을 찾을 수 없어요.')
    version(w,request.data.get('version'))
    use_image = request.data.get('useImage', True)
    if type(use_image) is not bool:
        fail('이미지 분석 여부를 확인해 주세요.')
    draft_image = request.data.get('useDraftImage', False)
    if type(draft_image) is not bool:
        fail('요약·가이드의 도판 사용 여부를 확인해 주세요.')
    regenerate=request.data.get('regenerateFields',[])
    if not isinstance(regenerate,list) or any(f not in STATES for f in regenerate):fail()
    if w.review_status!='approved' or not w.description.strip():fail('승인된 원문을 먼저 준비해 주세요.')
    if draft_image:
        from .llm import DRAFT_TASKS, luna_image_route
        if not regenerate or not w.image_file or not all(kind in DRAFT_TASKS and luna_image_route(kind) for kind in regenerate):
            fail('업로드 도판은 Luna 요약·가이드 요청에서 사용할 수 있어요.')
    deadline=budget.monotonic()+budget.ANALYSIS_SECONDS
    snapshot = artwork_dto(w, True)
    results={};updates={};model_cache={};retry_waits=[]
    with analysis_slot():
        for kind,field in STATES.items():
            confirmed = getattr(w, field) == 'confirmed'
            if kind not in regenerate and (regenerate or confirmed):
                results[kind] = {'ok': True, 'source': 'kept' if confirmed else 'skipped', 'made': False}
                continue
            try:
                budget.remaining(deadline, budget.ANALYSIS_SECONDS)
                context = {'deadline': deadline}
                if kind in ('tag', 'emotion') and settings.ARTI_MODEL_SERVICE_URL:
                    context.update(analysis_cache=model_cache, use_image=use_image)
                if draft_image:
                    context['draft_image_file'] = w.image_file
                value=providers.generate(kind,snapshot,**context)
                budget.remaining(deadline, budget.ANALYSIS_SECONDS)
                providers.validate(kind,value)
                if kind == 'guide' and settings.ARTI_DRAFT_GUIDE_REVIEW:
                    providers.review_guide(snapshot, value, **context)
                updates[kind]=value
                results[kind]={'ok':True,'source':'provider','made':True}
            except ContractError as e:
                if draft_image and e.status_code in (400, 413, 415):
                    raise
                results[kind]={'ok':False,'error':str(e.detail),'code':e.contract_code,'made':False}
                if getattr(e,'wait',None) is not None:retry_waits.append(e.wait)
    # 전체 예산이 소진되면 앞서 받은 부분 결과도 저장하지 않습니다.
    budget.remaining(deadline, budget.ANALYSIS_SECONDS)
    if not updates:
        if any(not r['ok'] for r in results.values()):
            codes={r.get('code') for r in results.values() if not r['ok']}
            statuses = {'AI_TIMEOUT': 504, 'GUIDE_UNSUPPORTED': 502, 'PROVIDER_ERROR': 502,
                        'RATE_LIMITED': 429, 'AI_UNAVAILABLE': 503}
            code = next((code for code in statuses if code in codes), 'AI_UNAVAILABLE')
            message = results['guide']['error'] if code == 'GUIDE_UNSUPPORTED' else '분석 결과를 준비하지 못했어요.'
            error = ContractError(statuses[code], code, message, retryable=True)
            if code=='RATE_LIMITED':error.wait=min(30,max(1,int(max(retry_waits or [30]))))
            raise error
        return Response({'artwork':artwork_dto(w,True),**results})
    with analysis_write():
        current=get_locked(Artwork,w.id);version(current,w.version);old=before(current)
        public_before = artwork_dto(current)
        old['public_dto'] = public_before
        budget.remaining(deadline, budget.ANALYSIS_SECONDS)
        for kind,value in updates.items():
            if not isinstance(value,dict):raise ContractError(502,'PROVIDER_ERROR','분석 결과 형식을 확인할 수 없어요.',retryable=True)
            if kind in RETAINED_TEXT_FIELDS and getattr(current, STATES[kind]) == 'confirmed':
                current.retained_text[kind] = {
                    'sourceVersion': current.source_version,
                    'fields': {key: public_before[key] for key in RETAINED_TEXT_FIELDS[kind]},
                }
            if kind=='summary':current.summary=value.get('summary','');current.summary_keywords=value.get('keywords',[])
            elif kind=='guide':current.guide_intro=value.get('intro','');current.guided_looking=value.get('questions',[]);current.guided_hints=value.get('hints',[])
            elif kind=='tag':
                from .tag_scores import bind_evidence
                current.tag_scores=value['scores']
                current.tag_score_evidence=bind_evidence(value.get('tagEvidence'),value['scores'],current)
                current.tag_score_revision+=1
            else:current.analysis=value
            setattr(current,STATES[kind],'suggested')
        finish(current,old)
        budget.remaining(deadline, budget.ANALYSIS_SECONDS)
    return Response({'artwork':artwork_dto(current,True),**results})


@contextmanager
def analysis_write():
    # 외부 모델 호출 뒤의 짧은 저장에만 적용하고 전역 DB 설정은 바꾸지 않습니다.
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '2s'")
            yield
    except OperationalError as exc:
        if getattr(exc.__cause__, 'sqlstate', None) == '55P03':
            raise ContractError(503, 'TEMPORARY_UNAVAILABLE', '다른 수정이 저장 중이에요. 같은 입력으로 다시 시도해 주세요.', retryable=True) from None
        raise


@contextmanager
def analysis_slot():
    # Cross-worker coordination in PostgreSQL; no process-local lock masquerading as global.
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_lock(17052026)')
        acquired=cursor.fetchone()[0]
    if not acquired:
        from rest_framework.exceptions import Throttled
        raise Throttled(wait=1,detail='다른 작품 분석이 진행 중이에요.')
    try:yield
    finally:
        with connection.cursor() as cursor:cursor.execute('SELECT pg_advisory_unlock(17052026)')
