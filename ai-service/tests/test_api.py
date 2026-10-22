"""
API·점수 계산 테스트 — 실제 모델 대신 가짜 모델로 실행 (torch·모델 다운로드 불필요)
실행: pytest
"""
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.analyzer import combine, normalize_sum, scale_to_max
from app.emotions import EMOTION_KEYS


class FakeScorer:
    loaded = True

    def image_scores(self, image):
        return {"calm": 0.1, "joy": 0.6, "sadness": 0.05, "tension": 0.05, "awe": 0.1, "nostalgia": 0.1}

    def text_scores(self, text):
        # 해설에 '고요'가 있으면 평온이 가장 높게
        calm = 0.9 if "고요" in text else 0.2
        return {"calm": calm, "joy": 0.3, "sadness": 0.1, "tension": 0.1, "awe": 0.5, "nostalgia": 0.4}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "scorer", FakeScorer())
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


def test_image_and_text(client, monkeypatch):
    monkeypatch.setattr(main, "fetch_image", lambda url: Image.new("RGB", (8, 8)))
    r = client.post("/analyze", json={"description": "밝은 축제", "imageUrl": "https://example.com/a.png"})
    body = r.json()
    assert body["usedImage"] is True
    assert max(body["emotions"], key=body["emotions"].get) == "joy"  # 이미지 비중 60%


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
