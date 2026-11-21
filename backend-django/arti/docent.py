# 승인된 작품 근거와 진입 맥락을 재구성해 도슨트 응답을 요청합니다.
import re
import uuid
from django.http import HttpResponse
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response
from .http import ContractError
from .docent_memory import interest_signal, previous_memory_is_current, visit_context_enabled, visitor_context
from .docent_tools import ToolObservation, collection_tool_for, demo_tool_for
from .docent_transcript import consent_revision, save_successful_turn, transcript_storage_enabled, turn_uuid
from .serializers import artwork_dto
from .views import public_works
from . import docent_audio, providers

BASIC_TIPS=['그림에서 가장 밝은 곳을 먼저 찾아보세요. 눈이 가장 먼저 가는 곳이에요.',
            '화면에서 가장 넓게 쓰인 색은 무엇인가요?',
            '조금 떨어져서 한 번, 가까이 다가가서 한 번 보세요. 무엇이 달라 보이나요?']

# 관찰 안내는 관람자가 도판에서 스스로 확인할 지점만 제안합니다.
# 사실이나 해석을 함께 묻는 경우에는 확인 범위를 먼저 안내합니다.
FACT_OR_INTERPRETATION = re.compile(
    r'작가|화가|의도|의미|상징|역사|제작|그렸|그린|누구|언제|왜|때문|기법|연도|시대|소장|출처|유래|전시실|전시장'
)
BARE_PAST_REFERENCE = re.compile(
    r'(?:그때|아까|앞서|전에)\s*(?:그\s*)?(?:거|것|부분|말|얘기)(?:요|는|였죠)?'
    r'[\s.,!?…]*(?:(?:뭐|어디)(?:였죠|였나요|였더라|죠|인가요))?[\s.!?…]*'
)
IMAGE_LOOKING_TIPS = (
    (re.compile(r'위치|어디|왼쪽|오른쪽|위쪽|아래쪽|가운데'),
     '도판 전체를 펼쳐 보세요. 궁금한 부분이 가운데와 가장자리 중 어디에 가까운지 살펴보세요.'),
    (re.compile(r'형태|모양|윤곽|선이|곡선|직선'),
     '도판에서 눈에 띈 부분의 윤곽을 따라가 보세요. 선이 곧게 이어지는지, 휘어지는지 살펴보세요.'),
    (re.compile(r'색|빛|명암|밝|어둡|그림자'),
     '도판에서 눈에 띈 부분과 바로 옆을 번갈아 보세요. 색이나 밝기가 비슷한지 비교해 보세요.'),
)


# 도슨트 요청 빈도를 제한합니다.
class AIThrottle(AnonRateThrottle):
    rate='20/min'
    scope='ai'

    def get_cache_key(self,request,view):
        return self.cache_format % {'scope':self.scope,'ident':self.get_ident(request)}


class DocentAudioThrottle(AIThrottle):
    rate = '6/min'
    scope = 'docent-audio'


def bad():raise ContractError(400,'VALIDATION_ERROR','질문과 맥락을 확인해 주세요.')


def content_changed():
    return ContractError(409, 'CONTENT_CHANGED', '작품 자료가 변경됐어요. 새 내용을 확인해 주세요.')


def require_current_public_work(work, *, check_collection=False):
    # 모델을 기다리는 사이에 편집되거나 공개가 중단된 작품의 답변은 내보내지 않습니다.
    query = public_works().filter(pk=work.pk, content_version=work.content_version)
    if check_collection:
        current = query.select_related(None).only('source_version', 'docent_collection').first()
        if current is None or current.approved_docent_collection != work.approved_docent_collection:
            raise content_changed()
    elif not query.exists():
        raise content_changed()


def insufficient_evidence(request, question, artwork, *, approved_guide=None):
    answer = '등록된 작품 자료에서 확인할 수 없어요.'
    if approved_guide is not None:
        hint, source = approved_guide
        return Response({
            'answer': f'{answer} 작품에서 이 부분을 살펴보세요. {hint}',
            'mode': 'fallback',
            'sourceRefs': [source],
            'requestId': request.request_id,
        })
    tip = None
    if (artwork['imageFile'] or artwork['imageUrl']) and not FACT_OR_INTERPRETATION.search(question):
        tip = next((text for pattern, text in IMAGE_LOOKING_TIPS if pattern.search(question)), None)
    return Response({
        'answer': f'{answer} {tip}' if tip else f'{answer} 작품 해설에서 확인되는 내용은 이어서 설명해 드릴 수 있어요.',
        'mode': 'fallback' if tip else 'refusal',
        'sourceRefs': [],
        'requestId': request.request_id,
    })


@api_view(['POST'])
@throttle_classes([AIThrottle])
def ask(request,artwork_id):
    w=public_works().filter(pk=artwork_id).first()
    if not w:raise ContractError(404,'NOT_FOUND','작품 정보를 찾을 수 없어요.')
    body = request.data
    if not isinstance(body, dict):
        bad()
    q = body.get('question')
    if not isinstance(q,str) or not 1<=len(q.strip())<=500:bad()
    question = q.strip()
    transcript_turn = None
    transcript_consent = None
    if 'transcriptTurnId' in body:
        if 'visitId' not in body:
            bad()
        transcript_turn = turn_uuid(body['transcriptTurnId'])
        if transcript_storage_enabled() and request.user and request.user.role == 'user':
            transcript_consent = consent_revision(request.user)
    if 'visitId' in body:
        try:
            if uuid.UUID(body['visitId']).version!=4:bad()
        except (ValueError,TypeError,AttributeError):bad()
    collection = w.approved_docent_collection
    if 'docentEvidenceRevision' in body:
        revision = body['docentEvidenceRevision']
        if type(revision) is not int or revision < 0:
            bad()
        if revision != (collection['revision'] if collection else 0):
            raise content_changed()
    data=artwork_dto(w);entry=body.get('entryContext');context=None;refs=[]
    if entry is not None:
        if not isinstance(entry,dict) or entry.get('tab') not in ('desc','guided'):bad()
        if type(entry.get('contentVersion')) is not int:bad()
        if entry['contentVersion']!=w.content_version:raise content_changed()
        kind=entry.get('kind')
        if kind in ('original','summary'):
            if entry['tab']!='desc' or 'questionIndex' in entry:bad()
            text=data['description'] if kind=='original' else data['summary']
            if kind == 'summary' and not text.strip():bad()
            excerpt=entry.get('excerpt')
            if excerpt is not None:
                if not isinstance(excerpt,dict) or type(excerpt.get('start')) is not int or type(excerpt.get('end')) is not int:bad()
                if not 0<=excerpt['start']<excerpt['end']<=len(text) or excerpt['end']-excerpt['start']>500:bad()
                text=text[excerpt['start']:excerpt['end']]
                if not text.strip():bad()
            if text.strip():
                context={'kind':kind,'text':text}
                refs=[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':kind,'revision':data['summaryRevision'] if kind=='summary' else w.source_version}]
        elif kind in ('guide','generic_tip'):
            if entry['tab']!='guided' or 'excerpt' in entry:bad()
            index=entry.get('questionIndex')
            questions=data['guidedLooking'] if kind=='guide' else BASIC_TIPS
            if type(index) is not int or not 0<=index<len(questions):bad()
            if kind=='generic_tip' and entry.get('tipVersion')!='basic-v1':bad()
            context={'kind':kind,'question':questions[index]}
            if kind=='guide':refs=[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':'guide','revision':data['guideRevision']}]
        else:bad()
    history=body.get('history',[])
    if not isinstance(history,list) or len(history)>8:bad()
    for i,m in enumerate(history):
        if not isinstance(m,dict) or m.get('role')!=('user' if i%2==0 else 'assistant') or not isinstance(m.get('text'),str) or not 1<=len(m['text'])<=1000:bad()
    if len(history)%2:bad()
    earlier = body.get('earlierConversation')
    dialogue_order = False
    if earlier is not None:
        required = {'contentVersion', 'observations'}
        allowed = required | {'reference'}
        if (not isinstance(earlier, dict) or not required <= set(earlier) <= allowed
                or type(earlier['contentVersion']) is not int or 'visitId' not in body
                or ('reference' in earlier and earlier['reference'] != 'dialogue_order')
                or 'docentEvidenceRevision' not in body):
            bad()
        if earlier['contentVersion'] != w.content_version:
            raise content_changed()
        observations = earlier['observations']
        dialogue_order = earlier.get('reference') == 'dialogue_order'
        minimum, maximum = (0, 1) if dialogue_order else (1, 2)
        if (not isinstance(observations, list) or not minimum <= len(observations) <= maximum
                or any(not isinstance(text, str) or not text.strip() or len(text) > 500 for text in observations)):
            bad()
    if (dialogue_order and not observations) or (len(history) >= 4 and BARE_PAST_REFERENCE.fullmatch(question)):
        return Response({
            'answer': '앞에서 말씀하신 어느 부분을 다시 볼까요? 순서나 특징 하나만 알려 주세요.',
            'mode': 'refusal', 'sourceRefs': [], 'requestId': request.request_id,
        })
    memory = body.get('visitorMemory')
    exhibition_works = public_works(w.exhibition_id).select_related(None)
    visitor = visitor_context(w, request.user, memory, exhibition_works, question, context) if 'visitId' in body and not dialogue_order else {}
    # 참조는 제공자 응답을 받기 전에 현재 작품의 승인 자료에서 정합니다.
    if not refs and data['description'].strip():
        refs=[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':'original','revision':w.source_version}]
    evidence_context = {'collection': collection} if collection else {}
    if dialogue_order:
        evidence_context['dialogue_reference'] = observations[0].strip()
    elif earlier is not None:
        evidence_context['earlier_observations'] = [text.strip() for text in observations]
    approved_guide = None
    if data['guideStatus'] == 'confirmed':
        matching_hint = next((hint.strip() for approved_question, hint in zip(data['guidedLooking'], data['guidedHints'])
                              if approved_question.strip() == question and hint.strip()), None)
        if matching_hint:
            evidence_context['guide_evidence'] = {'question': question, 'hint': matching_hint}
            guide_ref = {'artworkId': w.id, 'sourceVersion': w.source_version, 'kind': 'guide',
                         'revision': data['guideRevision']}
            approved_guide = (matching_hint, guide_ref)
            if guide_ref not in refs:
                refs.append(guide_ref)
    if not refs and not collection:
        return insufficient_evidence(request, question, data)
    if visitor:
        evidence_context['visitor'] = visitor
    tool = collection_tool_for(w, question, collection) or demo_tool_for(w, question, collection)
    if tool:
        evidence_context['docent_tool'] = tool
    result=providers.generate('answer',data,entry=context,history=history,question=question,**evidence_context)
    if visitor.get('previousVisit') and (not previous_memory_is_current(request.user, request.auth)
            or visitor['previousVisit'] != visitor_context(w, request.user, memory, exhibition_works,
                                                           question, context).get('previousVisit')):
        raise ContractError(409, 'VISIT_CONTEXT_CHANGED', '지난 전시 기억이 바뀌었어요. 질문을 다시 보내 주세요.')
    if isinstance(result, ToolObservation):
        require_current_public_work(w, check_collection=True)
        return Response({'answer': result.text, 'mode': 'fallback', 'sourceRefs': [], 'requestId': request.request_id})
    if not isinstance(result,dict) or not isinstance(result.get('answer'),str) or not result['answer'].strip():
        raise ContractError(502,'PROVIDER_ERROR','답변 형식을 확인할 수 없어요.',retryable=True)
    providers.validate('answer',result)
    require_current_public_work(w, check_collection=True)
    if visitor.get('earlierInExhibition') and visitor['earlierInExhibition'] != visitor_context(
            w, request.user, memory, exhibition_works, question, context, include_previous=False).get('earlierInExhibition'):
        raise ContractError(409, 'VISIT_CONTEXT_CHANGED', '앞 작품의 자료가 바뀌었어요. 질문을 다시 보내 주세요.')
    used_collection = result.get('collectionEvidenceUsed', False)
    if (used_collection and not collection) or (not refs and not used_collection):
        return insufficient_evidence(request, question, data)
    if result.get('insufficientEvidence'):
        return insufficient_evidence(request, question, data, approved_guide=approved_guide)
    if collection and 'collectionEvidenceUsed' not in result:
        raise ContractError(502, 'PROVIDER_ERROR', '답변의 소장처 근거를 확인할 수 없어요.', retryable=True)
    if used_collection:
        refs.append({'artworkId': w.id, 'sourceVersion': w.source_version,
                     'kind': 'collection', 'revision': collection['revision'],
                     'url': collection['url'], 'accession': collection['accession']})
    response = {'answer': result['answer'], 'mode': 'llm', 'sourceRefs': refs, 'requestId': request.request_id}
    if 'visitId' in body and docent_audio.available(w):
        response['audioGrant'] = docent_audio.sign_answer(w, request.auth, body['visitId'], result['answer'])
    if visitor.get('previousVisit'):
        response['usedPreviousVisitMemory'] = True
    if visit_context_enabled(w.exhibition_id) and (signal := interest_signal(question, context)):
        response['interestSignal'] = signal
    if transcript_turn is not None:
        save_successful_turn(request, w, body['visitId'], transcript_turn, question, result['answer'], transcript_consent)
    return Response(response)


@api_view(['POST'])
@throttle_classes([DocentAudioThrottle])
def answer_audio(request, artwork_id):
    work = public_works().filter(pk=artwork_id).first()
    if work is None or not docent_audio.available(work):
        raise ContractError(404, 'NOT_FOUND', '답변 듣기를 제공하지 않아요.')
    data = request.data
    required = {'answer', 'audioGrant', 'visitId'}
    if (not isinstance(data, dict) or not required <= set(data) <= required | {'intent'}
            or data.get('intent', 'play') not in ('prepare', 'play')
            or not isinstance(data['answer'], str) or not 1 <= len(data['answer']) <= 1000
            or not isinstance(data['audioGrant'], str) or not 1 <= len(data['audioGrant']) <= 180
            or not isinstance(data['visitId'], str) or len(data['visitId']) > 36):
        bad()
    if not docent_audio.verify_answer(work, request.auth, data['visitId'], data['answer'], data['audioGrant']):
        raise ContractError(409, 'AUDIO_GRANT_INVALID', '이 답변의 음성을 만들 수 없어요. 새 질문을 보내 주세요.')
    intent = data.get('intent', 'play')
    listening = docent_audio.listening_available(work)
    if intent == 'prepare' and not listening:
        raise ContractError(404, 'NOT_FOUND', '답변 음성 준비를 제공하지 않아요.')
    audio = docent_audio.metered_synthesize(
        data['answer'], intent=intent, request_id=request.request_id if listening else None,
    )
    require_current_public_work(work, check_collection=True)
    return HttpResponse(audio, content_type='audio/wav', headers={'Cache-Control': 'private, no-store'})


@api_view(['POST'])
@throttle_classes([AIThrottle])
def explanation(request,artwork_id):
    w=public_works().filter(pk=artwork_id).first()
    if not w:raise ContractError(404,'NOT_FOUND','작품 정보를 찾을 수 없어요.')
    result=providers.generate('explanation',artwork_dto(w))
    if not isinstance(result,dict) or not isinstance(result.get('text'),str):raise ContractError(502,'PROVIDER_ERROR','해설 형식을 확인할 수 없어요.')
    require_current_public_work(w)
    return Response({'text':result['text'],'mode':'llm','sourceRefs':[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':'original','revision':w.source_version}]})
