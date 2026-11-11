# 모델 서비스: 텍스트·이미지의 감정 분석 결과를 구성합니다.
"""
ARTI 감정 항목 정의

- key  : 백엔드·프론트와 공유하는 영문 키 (backend/src/lib/emotion.ts 의 EMOTIONS 와 같아야 한다)
- ko   : 화면에 보여 줄 이름
- nli  : 한국어 해설 분석(mDeBERTa 제로샷)에 쓰는 라벨
- clip : 이미지 분석(CLIP 제로샷)에 쓰는 영어 문장. 여러 문장 점수를 평균해 표현에 따른 흔들림을 줄인다.
"""

EMOTIONS = [
    {"key": "calm", "ko": "평온", "nli": "평온함",
     "clip": ["a calm and peaceful painting", "a serene, tranquil artwork"]},
    {"key": "joy", "ko": "기쁨", "nli": "기쁨과 즐거움",
     "clip": ["a joyful and happy painting", "a cheerful, lively artwork"]},
    {"key": "sadness", "ko": "슬픔", "nli": "슬픔과 우울함",
     "clip": ["a sad and melancholic painting", "a sorrowful, gloomy artwork"]},
    {"key": "tension", "ko": "긴장", "nli": "긴장감과 불안",
     "clip": ["a tense and anxious painting", "a disturbing, unsettling artwork"]},
    {"key": "awe", "ko": "경외", "nli": "웅장함과 경외감",
     "clip": ["an awe-inspiring, majestic painting", "a sublime and grand artwork"]},
    {"key": "nostalgia", "ko": "그리움", "nli": "그리움과 향수",
     "clip": ["a nostalgic and wistful painting", "an artwork that evokes longing and memories"]},
]

EMOTION_KEYS = [e["key"] for e in EMOTIONS]

# 제로샷 분류 가설 문장: "이 글이 묘사하는 작품의 분위기는 평온함이다." 처럼 라벨이 끼워진다.
NLI_HYPOTHESIS = "이 글이 묘사하는 작품의 분위기는 {}이다."
