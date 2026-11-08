# 버전 충돌을 확인하며 관리자 편집·이미지·도면·검수를 저장합니다.
"""Versioned administrator edits; generated values are never client-owned."""
import re
import secrets
from pathlib import Path
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction, connection
from contextlib import contextmanager
from rest_framework.decorators import api_view, permission_classes, parser_classes, throttle_classes
from rest_framework.parsers import BaseParser
from rest_framework.response import Response
from .authentication import IsAdmin
from .http import ContractError
from .models import Artwork, Exhibition
from .serializers import artwork_dto, exhibition_dto
from .views import with_etag
from . import providers
from .docent import AIThrottle

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


def finish(w, old):
    if any(getattr(w, f) != old[f] for f in SOURCE):
        stale(w)
    if w.summary != old['summary'] or w.summary_status != old['summary_status']:
        w.summary_revision += 1
    if any(getattr(w, f) != old[f] for f in ('guide_intro','guided_looking','guided_hints','guide_status')):
        w.guide_revision += 1
    w.version += 1
    w.content_version += 1
    validate_save(w)


def before(w):
    import copy
    return {f:copy.deepcopy(getattr(w,f)) for f in SOURCE | {'summary','summary_status','guide_intro','guided_looking','guided_hints','guide_status'}}


@api_view(['GET','POST','PUT'])
@permission_classes([IsAdmin])
def artworks(request, artwork_id=None):
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
    if not isinstance(data['showImage'],bool): fail()
    for key in ['palette','tags','guidedLooking','guidedHints','summaryKeywords']:
        if not isinstance(data[key],list) or any(not isinstance(v,str) for v in data[key]) or len(data[key])>50: fail()
    for key in ['imageUrl','referenceUrl']:
        if data[key] and (not isinstance(data[key],str) or not re.match(r'^https?://[^\s]+$',data[key])): fail('이미지/출처 URL을 확인해 주세요.')
    with transaction.atomic():
        w=get_locked(Artwork,artwork_id) if artwork_id else Artwork()
        if artwork_id: version(w,data.get('version'))
        old=before(w)
        for key,field in FIELDS.items(): setattr(w,field,data[key])
        point=data['position']
        if point is not None and (not isinstance(point,dict) or set(point)!={'x','y'} or any(type(point[k]) not in (int,float) for k in point)): fail()
        w.position_x=None if point is None else point['x'];w.position_y=None if point is None else point['y']
        if not Exhibition.objects.filter(pk=w.exhibition_id).exists(): fail('전시를 먼저 등록해 주세요.')
        if artwork_id: finish(w,old)
        else: validate_save(w)
        return with_etag(artwork_dto(w,True))


@api_view(['GET','POST','PUT'])
@permission_classes([IsAdmin])
def exhibitions(request, ex_id=None):
    if request.method=='GET':
        qs=Exhibition.objects.all()
        if ex_id:
            ex=qs.filter(pk=ex_id).first()
            if not ex: raise ContractError(404,'NOT_FOUND','전시를 찾을 수 없어요.')
            return with_etag(exhibition_dto(ex))
        return Response([exhibition_dto(e) for e in qs])
    if (request.method=='PUT')!=bool(ex_id): fail()
    data=request.data
    fields={'title':'title','subtitle':'subtitle','venue':'venue','startDate':'start_date','endDate':'end_date','status':'status','rooms':'rooms'}
    if not (set(fields)|{'entrance'}).issubset(data):fail('전시 편집 필수 필드를 확인해 주세요.')
    point=data['entrance']
    if not isinstance(point,dict) or set(point)!={'x','y'} or any(type(point[k]) not in (int,float) for k in point):fail()
    with transaction.atomic():
        ex=get_locked(Exhibition,ex_id) if ex_id else Exhibition()
        if ex_id:version(ex,data.get('version'))
        for key,field in fields.items():setattr(ex,field,data[key])
        if not isinstance(ex.rooms,list):fail()
        if ex_id and Artwork.objects.filter(exhibition=ex).exclude(room_id='').exclude(room_id__in=[r.get('id') for r in ex.rooms if isinstance(r,dict)]).exists():
            fail('작품이 배정된 전시실을 먼저 변경해 주세요.')
        ex.entrance_x=point['x'];ex.entrance_y=point['y']
        if ex_id:ex.version+=1
        validate_save(ex)
        # Model clean coerces dates on full_clean.
        return with_etag(exhibition_dto(ex))


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
def image(request, artwork_id=None, ex_id=None):
    with transaction.atomic():
        obj=get_locked(Artwork,artwork_id) if artwork_id else get_locked(Exhibition,ex_id)
        match=re.fullmatch(r'"([1-9][0-9]*)"',request.headers.get('If-Match',''))
        if not match:fail('If-Match에 현재 version을 보내 주세요.')
        version(obj,int(match[1]))
        old=before(obj) if artwork_id else None
        filename=None
        if request.method=='POST':
            data=request.data
            ext=image_bytes(data,request.content_type)
            if ex_id:
                try:width=int(request.query_params['width']);height=int(request.query_params['height'])
                except (KeyError,ValueError):fail()
                if not 1<=width<=20000 or not 1<=height<=20000:fail()
            filename=secrets.token_hex(24)+'.'+ext
            root=Path(settings.MEDIA_ROOT);root.mkdir(parents=True,exist_ok=True)
            (root/filename).write_bytes(data)
        try:
            if artwork_id:
                obj.image_file=filename;finish(obj,old)
            else:
                obj.floor_plan={'file':filename,'width':width,'height':height} if filename else None
                obj.version+=1;validate_save(obj)
                # A replaced plan cannot carry a previously checked coordinate forward.
                for w in Artwork.objects.select_for_update().filter(exhibition=obj):
                    w.position_x=w.position_y=None;w.version+=1;w.content_version+=1;w.save()
        except Exception:
            if filename:(Path(settings.MEDIA_ROOT)/filename).unlink(missing_ok=True)
            raise
        # Unlinked old files remain private, permitting deliberate later garbage collection.
        return with_etag(artwork_dto(obj,True) if artwork_id else exhibition_dto(obj))


@api_view(['POST'])
@permission_classes([IsAdmin])
def confirm_ai(request, ex_id):
    items=request.data.get('items')
    if not isinstance(items,list) or not 1<=len(items)<=100:fail('검토한 작품과 필드를 선택해 주세요.')
    if len({i.get('id') for i in items if isinstance(i,dict)})!=len(items):fail()
    with transaction.atomic():
        works=[]
        for item in items:
            if not isinstance(item,dict):fail()
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
@throttle_classes([AIThrottle])
def analyze(request,artwork_id):
    w=Artwork.objects.filter(pk=artwork_id).first()
    if not w:raise ContractError(404,'NOT_FOUND','작품을 찾을 수 없어요.')
    version(w,request.data.get('version'))
    regenerate=request.data.get('regenerateFields',[])
    if not isinstance(regenerate,list) or any(f not in STATES for f in regenerate):fail()
    if w.review_status!='approved' or not w.description.strip():fail('승인된 원문을 먼저 준비해 주세요.')
    results={};updates={}
    with analysis_slot():
        for kind,field in STATES.items():
            if getattr(w,field)=='confirmed' and kind not in regenerate:
                results[kind]={'ok':True,'source':'kept','made':False};continue
            try:
                value=providers.generate(kind,artwork_dto(w,True))
                providers.validate(kind,value)
                updates[kind]=value
                results[kind]={'ok':True,'source':'provider','made':True}
            except ContractError as e:results[kind]={'ok':False,'error':str(e.detail),'code':e.contract_code,'made':False}
    if not updates:
        if any(not r['ok'] for r in results.values()):
            codes={r.get('code') for r in results.values() if not r['ok']}
            code=next((c for c in ['AI_TIMEOUT','PROVIDER_ERROR','RATE_LIMITED','AI_UNAVAILABLE'] if c in codes),'AI_UNAVAILABLE')
            error=ContractError({'AI_TIMEOUT':504,'PROVIDER_ERROR':502,'RATE_LIMITED':429,'AI_UNAVAILABLE':503}[code],code,'분석 결과를 준비하지 못했어요.',retryable=True)
            if code=='RATE_LIMITED':error.wait=30
            raise error
        return Response({'artwork':artwork_dto(w,True),**results})
    with transaction.atomic():
        current=get_locked(Artwork,w.id);version(current,w.version);old=before(current)
        for kind,value in updates.items():
            if not isinstance(value,dict):raise ContractError(502,'PROVIDER_ERROR','분석 결과 형식을 확인할 수 없어요.',retryable=True)
            if kind=='summary':current.summary=value.get('summary','');current.summary_keywords=value.get('keywords',[])
            elif kind=='guide':current.guide_intro=value.get('intro','');current.guided_looking=value.get('questions',[]);current.guided_hints=value.get('hints',[])
            elif kind=='tag':current.tag_scores=value.get('scores')
            else:current.analysis=value
            setattr(current,STATES[kind],'suggested')
        finish(current,old)
    return Response({'artwork':artwork_dto(current,True),**results})

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
