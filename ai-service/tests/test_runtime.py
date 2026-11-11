# 이벤트로 로딩·동시 추론·실패/복구 경계를 결정적으로 검증합니다. 실제 가중치는 쓰지 않습니다.
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from app import main
from app.runtime import ModelRuntime
from app.analyzer import HuggingFaceScorer
from .test_api import FakeScorer


def client_for(monkeypatch, scorer):
    runtime=ModelRuntime()
    monkeypatch.setattr(main,'runtime',runtime)
    monkeypatch.setattr(main,'scorer',scorer)
    return TestClient(main.app),runtime


def test_cold_requests_fail_fast_and_load_once(monkeypatch):
    entered=threading.Event();release=threading.Event()
    class Cold(FakeScorer):
        loaded=False;calls=0
        def load(self):
            self.calls+=1;entered.set();release.wait(3);self.loaded=True
    scorer=Cold();client,runtime=client_for(monkeypatch,scorer)
    try:
        assert client.get('/ready').status_code==503
        assert client.post('/analyze',json={'description':'고요한 그림'}).status_code==503
        assert entered.wait(1)
        assert client.post('/analyze',json={'description':'고요한 그림'}).status_code==503
        assert scorer.calls==1
        assert client.get('/health').json()['modelState']=='loading'
    finally:
        release.set();runtime._loader.join(2)
    assert client.get('/ready').status_code==200
    assert client.post('/analyze',json={'description':'고요한 그림'}).status_code==200


def test_busy_inference_rejected_without_queue_and_releases(monkeypatch):
    entered=threading.Event();release=threading.Event()
    class Slow(FakeScorer):
        def text_scores(self,text):
            entered.set();release.wait(3);return super().text_scores(text)
    client,runtime=client_for(monkeypatch,Slow())
    with ThreadPoolExecutor(1) as pool:
        future=pool.submit(client.post,'/analyze',json={'description':'고요한 그림'})
        try:
            assert entered.wait(1)
            r=client.post('/analyze',json={'description':'다른 그림'})
            assert r.status_code==429 and r.headers['retry-after']=='1'
            assert client.get('/health').json()['analysisBusy']
        finally:release.set()
        assert future.result(2).status_code==200
    assert not client.get('/health').json()['analysisBusy']
    assert client.post('/analyze',json={'description':'고요한 그림'}).status_code==200


def test_load_failure_backoff_and_next_request_recovery(monkeypatch):
    class Cold(FakeScorer):
        loaded=False;calls=0;fail=True
        def load(self):
            self.calls+=1
            if self.fail:raise RuntimeError('synthetic load failure')
            self.loaded=True
    scorer=Cold();client,runtime=client_for(monkeypatch,scorer)
    assert client.post('/analyze',json={'description':'고요'}).status_code==503
    runtime._loader.join(2)
    assert runtime.state(scorer)=='failed'
    assert client.post('/analyze',json={'description':'고요'}).status_code==503
    assert scorer.calls==1
    scorer.fail=False;runtime._retry_at=0
    assert client.post('/analyze',json={'description':'고요'}).status_code==503
    runtime._loader.join(2)
    assert client.post('/analyze',json={'description':'고요'}).status_code==200


def test_inference_failure_does_not_stick_slot(monkeypatch):
    class Broken(FakeScorer):
        fail=True
        def text_scores(self,text):
            if self.fail:raise RuntimeError('synthetic compute failure')
            return super().text_scores(text)
    scorer=Broken();client,_=client_for(monkeypatch,scorer)
    assert client.post('/analyze',json={'description':'고요'}).status_code==503
    scorer.fail=False
    assert client.post('/analyze',json={'description':'고요'}).status_code==200


def test_partial_model_initialization_never_ready():
    scorer=HuggingFaceScorer()
    clip=SimpleNamespace(eval=lambda:'clip')
    module=SimpleNamespace(CLIPModel=SimpleNamespace(from_pretrained=lambda _:clip),
                           CLIPProcessor=SimpleNamespace(from_pretrained=lambda _:'processor'),
                           pipeline=lambda *a,**k:(_ for _ in ()).throw(RuntimeError('NLI failed')))
    with patch.dict(sys.modules,transformers=module),pytest.raises(RuntimeError):scorer.load()
    assert not scorer.loaded and scorer._clip is None and scorer._clip_processor is None
    module.pipeline=lambda *a,**k:'nli'
    with patch.dict(sys.modules,transformers=module):scorer.load()
    assert scorer.loaded and scorer._clip_processor=='processor'


def test_loader_thread_failure_keeps_health_and_retry_boundary():
    from fastapi import HTTPException
    scorer=FakeScorer();scorer.loaded=False
    runtime=ModelRuntime()
    with patch('app.runtime.threading.Thread.start',side_effect=RuntimeError('synthetic thread failure')):
        with pytest.raises(HTTPException) as exc:
            with runtime.slot(scorer):pass
    assert exc.value.status_code==503
    assert runtime.state(scorer)=='failed' and not runtime._gate.locked()
