# 관람 기록 저장·중복 방지와 회원·관리자 조회를 처리합니다.
import uuid
from django.db.models import Count, Max, Q
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response
from .authentication import IsAdmin
from .http import ContractError
from .constants import LABELS
from .member import member, user_dto
from .models import Account, Visit, VisitReaction
from .recommendations import profile_snapshot
from .serializers import TasteProfileInput, artwork_dto
from .taste_evidence import read_visit_evidence, receipt_hash, uuid_value
from .taste_resolution import locked_actor, taste_transaction
from .views import public_exhibition, public_works
from . import providers
from .docent import AIThrottle


def bad(message='관람 기록 입력을 확인해 주세요.'):
    raise ContractError(400,'VALIDATION_ERROR',message)


def canonical(data, account=None):
    try:visit_id=uuid.UUID(data.get('visitId',''))
    except (ValueError,TypeError,AttributeError):bad('관람 식별자가 필요해요.')
    if visit_id.version!=4:bad()
    ex=public_exhibition(data.get('exhibitionId'))
    ids=data.get('viewedArtworkIds')
    if not isinstance(ids,list) or len(ids)>200 or any(not isinstance(i,str) for i in ids):bad()
    ids=list(dict.fromkeys(ids))
    works=list(public_works(ex.id));by_id={w.id:w for w in works}
    if any(i not in by_id for i in ids):bad('공개된 같은 전시의 작품만 기록할 수 있어요.')
    reactions=data.get('reactions',{});reasons=data.get('reactionReasons',{});dwell=data.get('dwell',{})
    for mapping in [reactions,reasons,dwell]:
        if not isinstance(mapping,dict) or any(k not in ids for k in mapping):bad()
    if any(v not in ['like','dislike'] for v in reactions.values()):bad()
    if any(k not in reactions or not isinstance(v,str) or len(v)>500 for k,v in reasons.items()):bad()
    if any(type(v) is not int or not 0<=v<=86400 for v in dwell.values()):bad()
    date=data.get('date')
    if not isinstance(date,str) or len(date)>50:bad()
    try:dt=parse_datetime(date)
    except ValueError:bad()
    if not dt or timezone.is_naive(dt):bad('관람 시각에 시간대를 포함해 주세요.')
    numeric={'durationMin':1440,'recommendedCount':200,'requestGeneration':2147483647}
    for key,maximum in numeric.items():
        if type(data.get(key)) is not int or not 0<=data[key]<=maximum:bad()
    if data.get('selectedDuration') not in ('30m','60m','relaxed'):bad()
    incoming=data.get('tasteProfile')
    if incoming is not None and not isinstance(incoming,dict):bad()
    tags=data.get('tastes',(incoming or {}).get('selectedTags',[]))
    proof = data.get('tasteEvidenceReceipt')
    proof_hash = receipt_hash(proof)
    if incoming is not None:
        form = TasteProfileInput(data=incoming)
        form.is_valid(raise_exception=True)
        validated = form.validated_data
    else:
        validated = None
    if validated and validated['version'] == 2:
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags) or len(set(tags)) != len(tags):
            bad()
        profile = read_visit_evidence(proof, account, str(visit_id), ex.id, validated, tags)
    else:
        if proof is not None:
            bad('관람 취향 근거와 프로필 버전이 일치하지 않아요.')
        profile = profile_snapshot(tags, incoming, works, account, ex.id)
    value={k:data[k] for k in ['date','durationMin','recommendedCount','selectedDuration','requestGeneration']}
    value.update(visitId=str(visit_id),exhibitionId=ex.id,viewedArtworkIds=ids,reactions=reactions,
                 reactionReasons=reasons,dwell=dwell,tastes=tags,tasteProfile=profile,
                 exhibitionTitle=ex.title,venue=ex.venue,submittedTasteProfile=incoming)
    if proof_hash is not None:
        value['tasteEvidenceReceiptHash'] = proof_hash
    return value,[{k:artwork_dto(by_id[i])[k] for k in ['id','title','artist','year','tags','analysis']} for i in ids]


def longest_viewed(payload):
    """체류 시간이 같으면 관람 순서를 사용해 JSON 키 순서에 영향받지 않습니다."""
    dwell = payload['dwell']
    return max(payload['viewedArtworkIds'], key=lambda artwork_id: dwell.get(artwork_id, -1), default=None)


def dto(v):
    p={k: value for k, value in v.canonical_payload.items() if k != 'tasteEvidenceReceiptHash'}
    return {**p,'id':v.id,'userId':v.user_id,'persisted':True,'artworkSnapshots':v.artwork_snapshots,
            'interpretation':v.interpretation,'emotionProfile':v.emotion_profile,
            'longestViewedArtworkId':longest_viewed(p),
            'keywords':[LABELS[t] for t in p['tastes'][:4]]}


@api_view(['POST'])
def save_visit(request):
    actor=member(request) if getattr(request,'provided_token',False) else None
    if not actor:
        payload,snapshots=canonical(request.data)
        public_payload = {k: value for k, value in payload.items() if k != 'tasteEvidenceReceiptHash'}
        return Response({**public_payload,'id':payload['visitId'],'userId':None,'persisted':False,'artworkSnapshots':snapshots,
                         'interpretation':None,'emotionProfile':None,'keywords':[LABELS[t] for t in payload['tastes'][:4]],
                         'longestViewedArtworkId':longest_viewed(payload) if payload['dwell'] else None})
    visit_id = uuid_value(request.data.get('visitId'), visit=True)
    with taste_transaction():
        actor = locked_actor(request)
        # 기존 영수증은 현재 전시나 서명 만료를 검사하기 전에 같은 요청인지 확인합니다.
        existing=Visit.objects.filter(user=actor,visit_id=visit_id).first()
        if existing:
            check_retry(existing,request.data);return Response(dto(existing))
        payload,snapshots=canonical(request.data,actor)
        v=Visit.objects.create(user=actor,visit_id=payload['visitId'],exhibition_id=payload['exhibitionId'],
                               canonical_payload=payload,artwork_snapshots=snapshots)
        VisitReaction.objects.bulk_create([VisitReaction(visit=v,artwork_id=k,reaction=value,
            reason=payload['reactionReasons'].get(k,''),dwell_seconds=payload['dwell'].get(k,0)) for k,value in payload['reactions'].items()])
    return Response(dto(v),status=201)


def check_retry(v,data):
    p=v.canonical_payload
    ids=data.get('viewedArtworkIds')
    profile=data.get('tasteProfile')
    if not isinstance(ids,list) or any(not isinstance(i,str) for i in ids):bad()
    if profile is not None and not isinstance(profile,dict):bad()
    data={**data,'visitId':uuid_value(data.get('visitId'), visit=True),
          'tastes':data.get('tastes',(profile or {}).get('selectedTags',[]))}
    for key in ['visitId','exhibitionId','date','durationMin','recommendedCount','selectedDuration','requestGeneration','reactions','reactionReasons','dwell','tastes']:
        if data.get(key,{} if key in ('reactions','reactionReasons','dwell') else [] if key=='tastes' else None)!=p[key]:
            raise ContractError(409,'IDEMPOTENCY_CONFLICT','같은 관람에 다른 내용이 전송됐어요. 기존 기록은 유지됩니다.')
    if list(dict.fromkeys(ids))!=p['viewedArtworkIds']:
        raise ContractError(409,'IDEMPOTENCY_CONFLICT','관람 내용이 달라졌어요.')
    if data.get('tasteProfile')!=p['submittedTasteProfile']:
        raise ContractError(409,'IDEMPOTENCY_CONFLICT','취향 내용이 달라졌어요.')
    if receipt_hash(data.get('tasteEvidenceReceipt')) != p.get('tasteEvidenceReceiptHash'):
        raise ContractError(409, 'IDEMPOTENCY_CONFLICT', '관람 취향 근거가 달라졌어요.')


@api_view(['GET'])
def visits(request,visit_id=None,user_id=None):
    a=member(request,user_id)
    if visit_id:
        v=Visit.objects.filter(pk=visit_id).first()
        if not v:raise ContractError(404,'NOT_FOUND','관람 기록을 찾을 수 없어요.')
        if v.user_id!=a.id:raise ContractError(403,'FORBIDDEN','본인 기록만 볼 수 있어요.')
        return Response(dto(v))
    return Response([dto(v) for v in Visit.objects.filter(user=a).order_by('-created_at')])


@api_view(['POST'])
@throttle_classes([AIThrottle])
def interpret(request):
    a=member(request) if getattr(request,'provided_token',False) else None
    ex=public_exhibition(request.data.get('exhibitionId'))
    ids=request.data.get('viewedArtworkIds')
    if not isinstance(ids,list) or len(ids)>200 or any(not isinstance(i,str) for i in ids):bad()
    try:
        if uuid.UUID(request.data.get('visitId','')).version!=4:bad()
    except (ValueError,TypeError,AttributeError):bad()
    for name in ('reactions','dwell'):
        mapping=request.data.get(name)
        if not isinstance(mapping,dict) or any(k not in ids for k in mapping):bad()
        if name=='reactions' and any(v not in ('like','dislike') for v in mapping.values()):bad()
        if name=='dwell' and any(type(v) is not int or not 0<=v<=86400 for v in mapping.values()):bad()
    works=list(public_works(ex.id).filter(pk__in=ids))
    if len(set(ids))!=len(works):bad()
    v=None
    if a:
        try:v=Visit.objects.filter(user=a,visit_id=request.data.get('visitId')).first()
        except Exception:bad()
        if not v:bad('관람 기록을 먼저 저장해 주세요.')
        for key in ['exhibitionId','viewedArtworkIds','reactions','dwell']:
            if request.data.get(key)!=v.canonical_payload[key]:bad('저장된 관람과 요청이 달라요.')
    result=providers.generate('interpret',{'artworks':[artwork_dto(w) for w in works],
                                          'reactions':request.data.get('reactions',{}),'dwell':request.data.get('dwell',{})})
    providers.validate('interpret',result)
    if v:
        v.interpretation=result['text'];v.save(update_fields=['interpretation'])
    return Response({'text':result['text'],'mode':'llm','source':'llm','emotionProfile':None})


@api_view(['GET'])
@permission_classes([IsAdmin])
def reactions(request):
    try:limit=min(100,max(1,int(request.query_params.get('limit',50))));offset=max(0,int(request.query_params.get('offset',0)))
    except ValueError:bad()
    qs=VisitReaction.objects.select_related('visit','artwork').order_by('-id')
    if request.query_params.get('exhibitionId'):qs=qs.filter(visit__exhibition_id=request.query_params['exhibitionId'])
    return Response({'total':qs.count(),'items':[{'artworkId':r.artwork_id,'title':r.artwork.title,'reaction':r.reaction,
        'reason':r.reason,'dwellSeconds':r.dwell_seconds,'visitId':str(r.visit.visit_id),'date':r.visit.created_at.isoformat()} for r in qs[offset:offset+limit]]})


@api_view(['GET'])
@permission_classes([IsAdmin])
def members(request):
    qs=Account.objects.filter(role='user');q=request.query_params.get('q','')[:100]
    if q:qs=qs.filter(Q(email__icontains=q)|Q(nickname__icontains=q))
    qs=qs.annotate(visit_count=Count('visit'),last_visit=Max('visit__created_at')).order_by('-created_at','id')
    return Response([{**user_dto(a),'visitCount':a.visit_count,
                     'lastVisit':a.last_visit.isoformat() if a.last_visit else None} for a in qs[:100]])


@api_view(['GET'])
@permission_classes([IsAdmin])
def admin_member_visits(request,user_id):
    if not Account.objects.filter(pk=user_id,role='user').exists():
        raise ContractError(404,'NOT_FOUND','회원을 찾을 수 없어요.')
    return Response([dto(v) for v in Visit.objects.filter(user_id=user_id).order_by('-created_at','id')])


@api_view(['GET'])
@permission_classes([IsAdmin])
def admin_visit(request,visit_id):
    v=Visit.objects.filter(pk=visit_id).first()
    if not v:raise ContractError(404,'NOT_FOUND','관람 기록을 찾을 수 없어요.')
    return Response(dto(v))
