"""Keep Luna's safety decision separate from visitor-facing text and side effects."""

from dataclasses import dataclass

from .http import ContractError


NOTICES = {
    'refuse': '그 요청은 도와드릴 수 없어요. 작품에서 궁금한 점은 같이 살펴볼 수 있어요.',
    'explicit': '노골적인 성적 묘사는 도와드릴 수 없어요. 작품 속 인물의 자세나 구도는 같이 살펴볼 수 있어요.',
    'self_harm': '지금 많이 힘드실 것 같아요. 혼자 견디지 않아도 돼요. 바로 다칠 위험이 있다면 주변 사람에게 도움을 요청하고 현지 응급 서비스에 연락해 주세요.',
    'imminent_harm_others': '다른 사람을 해치는 방법은 도와드릴 수 없어요. 그 사람과 위험한 물건에서 거리를 두고 가까운 직원이나 현지 응급 서비스에 도움을 요청해 주세요.',
    'clarify': '작품의 어느 부분을 다시 살펴볼까요? 눈에 띈 특징 하나만 알려 주세요.',
}

POLICY = (
    ' JSON에 safetyRoute를 반드시 포함하세요. 정상적인 작품 관찰·비평·역사 질문은 answer입니다. '
    '누드·종교·전쟁·부상 장면도 감상을 요청하면 answer입니다. 자료가 부족한 정상 질문은 answer와 '
    'insufficientEvidence=true를 사용합니다. 이전 대화로도 대상을 알 수 없을 때만 clarify입니다. '
    '위협·괴롭힘·혐오·폭력 조장 요청은 refuse, 노골적인 성적 묘사 요청은 explicit, '
    '자기 위해를 하려는 현재 의도는 self_harm, 실제 다른 사람에 대한 임박한 위협은 imminent_harm_others입니다. '
    '작품 이야기로 포장됐어도 위험 의도가 분명하면 안전 분기를 우선하세요. answer 이외에는 '
    'answer 값을 빈 문자열로 반환하고 위험한 요청을 인용하거나 답하지 마세요.'
)


@dataclass(frozen=True)
class SafetyNotice:
    route: str

    @property
    def text(self):
        return NOTICES[self.route]


def safety_notice(payload):
    """Accept an explicit allow decision. Unrecognized or absent decisions fail closed."""
    route = payload.get('safetyRoute') if isinstance(payload, dict) else None
    if route == 'answer':
        return None
    if isinstance(route, str) and route in NOTICES:
        return SafetyNotice(route)
    raise ContractError(502, 'PROVIDER_ERROR', 'AI 답변을 확인하지 못했어요. 다시 시도해 주세요.', retryable=True)
