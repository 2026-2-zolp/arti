# 승인된 작품 근거와 진입 맥락을 재구성해 도슨트 응답을 요청합니다.
import uuid
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response
from .http import ContractError
from .serializers import artwork_dto
from .views import public_works
from . import providers

BASIC_TIPS=['그림에서 가장 밝은 곳을 먼저 찾아보세요. 눈이 가장 먼저 가는 곳이에요.',
            '화면에서 가장 넓게 쓰인 색은 무엇인가요?',
            '조금 떨어져서 한 번, 가까이 다가가서 한 번 보세요. 무엇이 달라 보이나요?']


# 도슨트 요청 빈도를 제한합니다.
class AIThrottle(AnonRateThrottle):
    rate='20/min'
    scope='ai'

    def get_cache_key(self,request,view):
        return self.cache_format % {'scope':self.scope,'ident':self.get_ident(request)}


def bad():raise ContractError(400,'VALIDATION_ERROR','질문과 맥락을 확인해 주세요.')


@api_view(['POST'])
@throttle_classes([AIThrottle])
def ask(request,artwork_id):
    w=public_works().filter(pk=artwork_id).first()
    if not w:raise ContractError(404,'NOT_FOUND','작품 정보를 찾을 수 없어요.')
    body=request.data;q=body.get('question')
    if not isinstance(q,str) or not 1<=len(q.strip())<=500:bad()
    if 'visitId' in body:
        try:
            if uuid.UUID(body['visitId']).version!=4:bad()
        except (ValueError,TypeError,AttributeError):bad()
    data=artwork_dto(w);entry=body.get('entryContext');context=None;refs=[]
    if entry is not None:
        if not isinstance(entry,dict) or entry.get('tab') not in ('desc','guided'):bad()
        if type(entry.get('contentVersion')) is not int:bad()
        if entry['contentVersion']!=w.content_version:raise ContractError(409,'CONTENT_CHANGED','작품 자료가 변경됐어요. 새 내용을 확인해 주세요.')
        kind=entry.get('kind')
        if kind in ('original','summary'):
            if entry['tab']!='desc' or 'questionIndex' in entry:bad()
            text=data['description'] if kind=='original' else data['summary']
            if not text:bad()
            excerpt=entry.get('excerpt')
            if excerpt is not None:
                if not isinstance(excerpt,dict) or type(excerpt.get('start')) is not int or type(excerpt.get('end')) is not int:bad()
                if not 0<=excerpt['start']<excerpt['end']<=len(text) or excerpt['end']-excerpt['start']>500:bad()
                text=text[excerpt['start']:excerpt['end']]
            context={'kind':kind,'text':text}
            refs=[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':kind,'revision':w.summary_revision if kind=='summary' else w.source_version}]
        elif kind in ('guide','generic_tip'):
            if entry['tab']!='guided' or 'excerpt' in entry:bad()
            index=entry.get('questionIndex')
            questions=data['guidedLooking'] if kind=='guide' else BASIC_TIPS
            if type(index) is not int or not 0<=index<len(questions):bad()
            if kind=='generic_tip' and entry.get('tipVersion')!='basic-v1':bad()
            context={'kind':kind,'question':questions[index]}
            if kind=='guide':refs=[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':'guide','revision':w.guide_revision}]
        else:bad()
    history=body.get('history',[])
    if not isinstance(history,list) or len(history)>8:bad()
    for i,m in enumerate(history):
        if not isinstance(m,dict) or m.get('role')!=('user' if i%2==0 else 'assistant') or not isinstance(m.get('text'),str) or not 1<=len(m['text'])<=1000:bad()
    if len(history)%2:bad()
    result=providers.generate('answer',data,entry=context,history=history,question=q.strip())
    if not isinstance(result,dict) or not isinstance(result.get('answer'),str) or not result['answer'].strip():
        raise ContractError(502,'PROVIDER_ERROR','답변 형식을 확인할 수 없어요.',retryable=True)
    providers.validate('answer',result)
    # Source references are selected by the server, never accepted from provider/client.
    if not refs and data['description']:refs=[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':'original','revision':w.source_version}]
    return Response({'answer':result['answer'],'mode':'llm','sourceRefs':refs,'requestId':request.request_id})


@api_view(['POST'])
@throttle_classes([AIThrottle])
def explanation(request,artwork_id):
    w=public_works().filter(pk=artwork_id).first()
    if not w:raise ContractError(404,'NOT_FOUND','작품 정보를 찾을 수 없어요.')
    result=providers.generate('explanation',artwork_dto(w))
    if not isinstance(result,dict) or not isinstance(result.get('text'),str):raise ContractError(502,'PROVIDER_ERROR','해설 형식을 확인할 수 없어요.')
    return Response({'text':result['text'],'mode':'llm','sourceRefs':[{'artworkId':w.id,'sourceVersion':w.source_version,'kind':'original','revision':w.source_version}]})
