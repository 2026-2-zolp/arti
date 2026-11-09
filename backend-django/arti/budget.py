# 관리자 분석의 전체 처리 예산을 공유하고 늦은 결과의 저장을 막습니다.
from time import monotonic
from .http import ContractError

ANALYSIS_SECONDS = 60


def remaining(deadline, maximum):
    seconds = maximum if deadline is None else min(maximum, deadline - monotonic())
    if seconds <= 0:
        raise ContractError(504, 'AI_TIMEOUT', '분석 시간이 초과됐어요. 다시 시도해 주세요.', retryable=True)
    return seconds
