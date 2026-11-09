# 모델 서비스: CLIP 기반 이미지 취향 태그를 계산합니다.
"""
ARTI 취향 태그 정의 — 사용자 취향 카드 = 관리자 태그 = AI 태그 (같은 8개)

그림의 겉모습(소재·형태·빛·색)만 분류한다. 감정(평온·기쁨 …)은 emotions.py에서 따로 분석해 설명용으로만 쓴다.

- key : 백엔드·프론트와 공유하는 영문 키 (backend/src/types.ts 의 TasteTag 와 같아야 한다)
- ko  : 화면에 보여 줄 이름
- pos : 이 태그에 해당하는 그림을 묘사하는 영어 문장 (CLIP 이미지 분석)
- neg : 해당하지 않는 그림을 묘사하는 영어 문장. pos와 neg 중 어느 쪽에 더 가까운지로 0~1 점수를 낸다
        → 태그마다 따로 판단하므로 한 그림이 '풍경'이면서 '빛'이면서 '따뜻한 색감'일 수 있다 (다중 라벨)
- nli : 그림이 없을 때 한국어 해설로 판단할 라벨 (mDeBERTa 제로샷)
"""

TAGS = [
    {"key": "landscape", "ko": "풍경", "nli": "자연 풍경",
     "pos": ["a landscape painting of nature", "a painting of mountains, sea, sky or fields"],
     "neg": ["a portrait or figure painting", "a painting of objects or an interior"]},
    {"key": "people", "ko": "인물", "nli": "사람",
     "pos": ["a painting of a person", "a portrait or a scene with people"],
     "neg": ["a painting with no people in it", "an empty landscape or a still life"]},
    {"key": "abstract", "ko": "추상", "nli": "추상적인 형태",
     "pos": ["an abstract painting of shapes, lines and colors", "a non-representational geometric artwork"],
     "neg": ["a realistic painting of recognizable things", "a figurative painting of real scenes"]},
    {"key": "light", "ko": "빛", "nli": "빛과 광채",
     # 어둠 속 광원(촛불·달빛)도 '빛'으로 보도록 고른 문장 (캡처 40점에서 AUC 0.59 → 0.84)
     "pos": ["a painting with luminous light glowing in the darkness", "a painting of brilliant sunlight and glow",
             "a painting with dramatic light and shadow"],
     "neg": ["a painting with flat, even, uninteresting lighting"]},
    {"key": "vivid", "ko": "강렬한 색감", "nli": "강렬한 색채",
     # 채도를 낮추거나 높인 같은 그림으로 시험해 고른 문장 (다른 후보는 거의 모든 그림을 0점으로 판단)
     "pos": ["a vibrant, colorful painting"],
     "neg": ["a muted, desaturated painting"]},
    {"key": "cool", "ko": "차가운 색감", "nli": "푸른색과 차가운 색조",
     "pos": ["a painting dominated by cool blue and green tones", "a bluish painting with cold colors"],
     "neg": ["a painting dominated by warm red, orange and yellow tones", "a painting with warm brown and golden colors"]},
    {"key": "warm", "ko": "따뜻한 색감", "nli": "붉은색과 따뜻한 색조",
     "pos": ["a painting dominated by warm red, orange and yellow tones", "a painting with warm brown and golden colors"],
     "neg": ["a painting dominated by cool blue and green tones", "a bluish painting with cold colors"]},
    {"key": "soft", "ko": "부드러운 색감", "nli": "부드럽고 은은한 색채",
     "pos": ["a painting with soft pastel colors", "a gentle painting with delicate, hazy tones"],
     "neg": ["a painting with harsh, strong colors", "a heavy, dark painting with hard edges"]},
]

TAG_KEYS = [t["key"] for t in TAGS]

# 그림이 없을 때 해설로 태그를 판단하는 가설 문장
TAG_NLI_HYPOTHESIS = "이 글이 묘사하는 작품의 특징은 {}이다."
