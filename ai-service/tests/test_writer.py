"""초보자용 글쓰기(Kanana) 결과 나누기·안전장치 테스트 — 실제 모델 없이 모델 답을 흉내 낸 글로 확인"""
from app.writer import parse, write

SRC = "1642년 암스테르담의 민병대가 주문한 단체 초상화예요. 어둠 속에서 몇몇 인물만 밝게 비쳐요."


def test_parse_splits_fields_even_when_headers_share_a_line():
    raw = (
        "요약: 1642년에 그린 단체 초상화예요. 몇몇 인물만 밝게 비쳐요. 키워드: 명암 대비, 단체 초상화, 민병대\n"
        "쉬운 설명: 어둠 속에서 빛이 중요한 사람을 비춰요.\n"
        "관찰 질문:\n"
        "1. 가장 밝은 사람은 누구인가요? | 어디를 보면 되는지 힌트: 가운데를 보세요\n"
        "2. 사람들은 움직이고 있나요? | 힌트: 창과 북을 보세요\n"
        "3. 배경은 어떤 색인가요? | (어두운 부분)\n"
    )
    r = parse(raw, SRC, "fake")
    assert r is not None
    assert r.summary == "1642년에 그린 단체 초상화예요. 몇몇 인물만 밝게 비쳐요."
    assert r.keywords == ["명암 대비", "단체 초상화", "민병대"]
    assert r.intro == "어둠 속에서 빛이 중요한 사람을 비춰요."
    assert r.questions[0] == "가장 밝은 사람은 누구인가요?"
    assert r.hints == ["가운데를 보세요", "창과 북을 보세요", "어두운 부분"]


def test_sentences_with_invented_years_are_dropped():
    raw = (
        "요약: 1642년에 그린 단체 초상화예요. 1999년 서울에서 다시 전시됐어요.\n"
        "키워드: 명암, 1999년 전시\n"
        "관찰 질문:\n1. 1999년에는 어디 있었나요? | 서울\n2. 가장 밝은 곳은 어디인가요? | 가운데\n"
    )
    r = parse(raw, SRC, "fake")
    assert r is not None
    assert "1999" not in r.summary and r.summary == "1642년에 그린 단체 초상화예요."
    assert r.keywords == ["명암"]
    assert r.questions == ["가장 밝은 곳은 어디인가요?"]
    assert any("1999" in d for d in r.dropped)


def test_unusable_answer_returns_none():
    assert parse("죄송해요, 잘 모르겠어요.", SRC, "fake") is None
    assert parse("요약: 1999년 작품이에요.\n관찰 질문:\n1. 무엇이 보이나요?", SRC, "fake") is None  # 요약이 다 걸러짐


class FakeWriter:
    loaded = True

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def generate(self, system, user):
        self.calls.append(user)
        return self.answer


def test_write_passes_description_and_skips_empty():
    fw = FakeWriter("요약: 단체 초상화예요.\n관찰 질문:\n1. 가장 밝은 곳은? | 가운데")
    assert write(fw, "야경", "렘브란트", "1642", "  ", "fake") is None and fw.calls == []
    r = write(fw, "야경", "렘브란트", "1642", SRC, "fake")
    assert r is not None and r.summary == "단체 초상화예요." and "<해설>" in fw.calls[0]
