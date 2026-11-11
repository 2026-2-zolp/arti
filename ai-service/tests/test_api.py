"""
API·점수 계산 테스트 — 실제 모델 대신 가짜 모델로 실행 (torch·모델 다운로드 불필요)
실행: pytest
"""
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.analyzer import apply_prior, calibrate_tags, combine, load_calibration, load_tag_thresholds, normalize_sum, scale_to_max
from app.emotions import EMOTION_KEYS
from app.tags import TAG_KEYS


class FakeScorer:
    loaded = True

    def image_scores(self, image):
        return {"calm": 0.1, "joy": 0.6, "sadness": 0.05, "tension": 0.05, "awe": 0.1, "nostalgia": 0.1}

    def text_scores(self, text):
        # 해설에 '고요'가 있으면 평온이 가장 높게
        calm = 0.9 if "고요" in text else 0.2
        return {"calm": calm, "joy": 0.3, "sadness": 0.1, "tension": 0.1, "awe": 0.5, "nostalgia": 0.4}

    def image_tag_scores(self, image):
        return {k: 0.1 for k in TAG_KEYS} | {"landscape": 0.9, "light": 0.8}

    def text_tag_scores(self, text):
        return {k: 0.2 for k in TAG_KEYS} | {"people": 0.7}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "scorer", FakeScorer())
    monkeypatch.setattr(main, "tag_thresholds", {})  # 실제 기준값 파일과 무관하게 테스트
    return TestClient(main.app)


def test_scale_and_combine():
    s = scale_to_max(normalize_sum({"calm": 2, "joy": 1, "sadness": 0, "tension": 0, "awe": 1, "nostalgia": 0}))
    assert s["calm"] == 1.0 and s["joy"] == 0.5 and set(s) == set(EMOTION_KEYS)
    img = {k: 0.0 for k in EMOTION_KEYS} | {"joy": 1.0}
    txt = {k: 0.0 for k in EMOTION_KEYS} | {"calm": 1.0}
    mixed = combine(img, txt, 0.6)
    assert mixed["joy"] == 1.0 and mixed["calm"] == pytest.approx(0.667, abs=0.001)
    assert combine(None, txt, 0.6)["calm"] == 1.0


def test_text_only(client):
    r = client.post("/analyze", json={"title": "산", "description": "고요한 산의 풍경"})
    assert r.status_code == 200
    body = r.json()
    assert body["usedImage"] is False and body["imageScores"] is None
    assert max(body["emotions"], key=body["emotions"].get) == "calm"
    assert body["emotions"]["calm"] == 1.0
    assert body["tagSource"] == "text" and body["tags"]["people"] == 0.7 and set(body["tags"]) == set(TAG_KEYS)


def test_image_and_text(client, monkeypatch):
    monkeypatch.setattr(main, "fetch_image", lambda url: Image.new("RGB", (8, 8)))
    r = client.post("/analyze", json={"description": "밝은 축제", "imageUrl": "https://example.com/a.png"})
    body = r.json()
    assert body["usedImage"] is True
    assert max(body["emotions"], key=body["emotions"].get) == "joy"  # 이미지 비중 60%
    assert body["tagSource"] == "image" and body["tags"]["landscape"] == 0.9  # 그림이 있으면 태그는 그림으로


def test_image_failure_falls_back_to_text(client, monkeypatch):
    def broken(url):
        raise main.ImageFetchError("이미지를 내려받지 못했어요 (HTTP 404).")

    monkeypatch.setattr(main, "fetch_image", broken)
    r = client.post("/analyze", json={"description": "고요한 호수", "imageUrl": "https://example.com/x.png"})
    body = r.json()
    assert r.status_code == 200 and body["usedImage"] is False
    assert "404" in body["imageError"]


def test_empty_input_is_400(client):
    assert client.post("/analyze", json={"title": "", "description": "  "}).status_code == 400


def test_health_and_emotions(client):
    assert client.get("/health").json()["ok"] is True
    assert [e["key"] for e in client.get("/emotions").json()] == EMOTION_KEYS
    assert [t["key"] for t in client.get("/tags").json()] == TAG_KEYS


def test_uploaded_image_base64(client):
    import base64, io
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 50, 50)).save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    body = client.post("/analyze", json={"description": "밝은 축제", "imageBase64": b64}).json()
    assert body["usedImage"] is True and body["imageError"] is None


def test_broken_base64_falls_back_to_text(client):
    body = client.post("/analyze", json={"description": "고요한 호수", "imageBase64": "!!!not-base64"}).json()
    assert body["usedImage"] is False and "base64" in body["imageError"]


def test_calibration_removes_label_bias(tmp_path):
    prior = {k: 0.0 for k in EMOTION_KEYS} | {"awe": 0.8}
    biased = {k: 0.2 for k in EMOTION_KEYS} | {"awe": 0.9, "calm": 0.6}
    assert max(biased, key=biased.get) == "awe"
    fixed = apply_prior(biased, prior)
    assert max(fixed, key=fixed.get) == "calm"  # 어디에나 높게 나오던 '경외'를 빼면 평온이 1위
    assert apply_prior({k: 0.1 for k in EMOTION_KEYS}, {k: 0.5 for k in EMOTION_KEYS}) == {k: 0.1 for k in EMOTION_KEYS}

    # 모든 감정이 평균보다 낮아도 보정 전 점수로 돌아가지 않고, 편향을 뺀 순서를 끝까지 유지
    prior2 = {"calm": 0.1, "joy": 0.2, "sadness": 0.2, "tension": 0.3, "awe": 0.5, "nostalgia": 0.3}
    low = {"calm": 0.09, "joy": 0.05, "sadness": 0.0, "tension": 0.1, "awe": 0.45, "nostalgia": 0.2}
    order = sorted(EMOTION_KEYS, key=apply_prior(low, prior2).get, reverse=True)
    assert order[:3] == ["calm", "awe", "nostalgia"] and max(low, key=low.get) == "awe"

    f = tmp_path / "calibration.json"
    f.write_text('{"prior": {"text": {"calm": 0.1, "joy": 0.1, "sadness": 0.1, "tension": 0.1, "awe": 0.5, "nostalgia": 0.1}}}')
    assert load_calibration(f)["text"]["awe"] == 0.5
    assert load_calibration(tmp_path / "missing.json") == {}


def test_tag_thresholds_map_to_half(tmp_path, client, monkeypatch):
    th = {k: 0.5 for k in TAG_KEYS} | {"warm": 0.9, "soft": 0.2}
    out = calibrate_tags({k: 0.6 for k in TAG_KEYS}, th)
    assert out["warm"] < 0.5 and out["soft"] > 0.5 and out["landscape"] == 0.6  # 기준값보다 낮으면 '해당 안 함'
    assert calibrate_tags({"warm": 0.9}, th)["warm"] == 0.5 and calibrate_tags({"warm": 1.0}, th)["warm"] == 1.0
    assert calibrate_tags({"warm": 0.3}, {}) == {"warm": 0.3}

    f = tmp_path / "tag_calibration.json"
    f.write_text('{"thresholds": ' + str(th).replace("'", '"') + '}')
    assert load_tag_thresholds(f)["warm"] == 0.9 and load_tag_thresholds(tmp_path / "none.json") == {}

    # 그림으로 판단한 태그에만 기준값 적용, 보정 전 점수는 tagsRaw
    monkeypatch.setattr(main, "tag_thresholds", {k: 0.5 for k in TAG_KEYS} | {"light": 0.9})
    monkeypatch.setattr(main, "fetch_image", lambda url: Image.new("RGB", (8, 8)))
    body = client.post("/analyze", json={"description": "x", "imageUrl": "https://example.com/a.png"}).json()
    assert body["tagsRaw"]["light"] == 0.8 and body["tags"]["light"] < 0.5
    text_only = client.post("/analyze", json={"description": "x"}).json()
    assert text_only["tags"] == text_only["tagsRaw"]


def test_title_only_used_without_image_and_description(client, monkeypatch):
    monkeypatch.setattr(main, "fetch_image", lambda url: Image.new("RGB", (8, 8)))
    with_image = client.post("/analyze", json={"title": "고요한 추억", "imageUrl": "https://example.com/a.png"}).json()
    assert with_image["usedImage"] is True and with_image["usedText"] is False and with_image["textScores"] is None
    title_only = client.post("/analyze", json={"title": "고요한 호수"}).json()
    assert title_only["usedText"] is True and max(title_only["emotions"], key=title_only["emotions"].get) == "calm"


class FakeWriter:
    loaded = True

    def generate(self, system, user):
        return "요약: 단체 초상화예요.\n키워드: 명암\n쉬운 설명: 빛이 사람을 비춰요.\n관찰 질문:\n1. 가장 밝은 곳은? | 가운데\n"


def test_write_returns_summary_and_guide(client, monkeypatch):
    monkeypatch.setattr(main.config, "WRITER_ENABLED", True)
    monkeypatch.setattr(main, "writer", FakeWriter())
    r = client.post("/write", json={"title": "야경", "artist": "렘브란트", "year": "1642", "description": "단체 초상화예요."})
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == "단체 초상화예요." and body["questions"] == ["가장 밝은 곳은?"] and body["hints"] == ["가운데"]
    assert client.post("/write", json={"description": " "}).status_code == 400


def test_write_unusable_answer_is_422(client, monkeypatch):
    monkeypatch.setattr(main.config, "WRITER_ENABLED", True)
    class Bad(FakeWriter):
        def generate(self, system, user):
            return "모르겠어요"
    monkeypatch.setattr(main, "writer", Bad())
    assert client.post("/write", json={"description": "단체 초상화예요."}).status_code == 422


def test_disabled_writer_does_not_generate(client, monkeypatch):
    from unittest.mock import Mock
    writer=Mock()
    monkeypatch.setattr(main,'writer',writer)
    monkeypatch.setattr(main.config,'WRITER_ENABLED',False)
    response=client.post('/write',json={'description':'합성 원문'})
    assert response.status_code==503
    writer.generate.assert_not_called()
