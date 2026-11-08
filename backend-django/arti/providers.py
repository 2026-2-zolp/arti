"""Provider boundary. W07 connects real providers; no production fake success."""
from .http import ContractError


def generate(kind, snapshot, **context):
    raise ContractError(503, 'AI_UNAVAILABLE', 'AI 연결을 준비 중이에요. 잠시 후 다시 시도해 주세요.', retryable=True)


def validate(kind,value):
    import math
    from .constants import TAGS, EMOTIONS
    def text(v,maximum=10000):return isinstance(v,str) and 0<len(v.strip())<=maximum
    def texts(v,maximum=50):return isinstance(v,list) and len(v)<=maximum and all(isinstance(x,str) and len(x)<=10000 for x in v)
    def scores(v,keys):return isinstance(v,dict) and bool(v) and all(k in keys and type(n) in (int,float) and math.isfinite(n) and 0<=n<=1 for k,n in v.items())
    valid=isinstance(value,dict)
    if valid:
        if kind=='summary':valid=text(value.get('summary')) and texts(value.get('keywords'))
        elif kind=='guide':valid=text(value.get('intro')) and texts(value.get('questions')) and texts(value.get('hints')) and len(value['questions'])==len(value['hints'])
        elif kind=='tag':valid=scores(value.get('scores'),TAGS)
        elif kind=='emotion':valid=scores(value.get('emotions'),EMOTIONS)
        elif kind in ('interpret','explanation'):valid=text(value.get('text'))
        elif kind=='answer':valid=text(value.get('answer'),1000)
    if not valid:raise ContractError(502,'PROVIDER_ERROR','AI 응답 형식을 확인할 수 없어요.',retryable=True)
