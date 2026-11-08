# 취향·감정·관람 시간과 AI 상태의 고정 계약을 정의합니다.
TAGS = ('landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft')
EMOTIONS = ('calm', 'joy', 'sadness', 'tension', 'awe', 'nostalgia')
LABELS = dict(zip(TAGS, ('풍경', '인물', '추상', '빛', '강렬한 색감', '차가운 색감', '따뜻한 색감', '부드러운 색감')))
DURATION_COUNTS = {'30m': 3, '60m': 5, 'relaxed': 7}
AI_STATES = ('none', 'suggested', 'confirmed')
