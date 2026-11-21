# 감정·텍스트 추론과 도판 태그 슬롯의 상태를 대기열 없이 알립니다.
import logging
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from fastapi import HTTPException

log=logging.getLogger('arti.ai')


class CompletedEmotionCache:
    """A bounded cache for completed calculations under the emotion slot."""

    def __init__(self, *, capacity=32, ttl=300, clock=time.monotonic):
        self._entries = OrderedDict()
        self._capacity = capacity
        self._ttl = ttl
        self._clock = clock

    def score(self, key, compute):
        cutoff = self._clock() - self._ttl
        for saved, (finished_at, _) in tuple(self._entries.items()):
            if finished_at <= cutoff:
                del self._entries[saved]
        if key in self._entries:
            self._entries.move_to_end(key)
            return self._entries[key][1]
        value = compute()
        self._entries[key] = (self._clock(), value)
        if len(self._entries) > self._capacity:
            self._entries.popitem(last=False)
        return value


class ModelRuntime:
    def __init__(self):
        self._gate=threading.Lock()
        self._image_tags=threading.Lock()
        self._state='not_loaded'
        self._retry_at=0.
        self._started_at=None

    def state(self, scorer):
        return 'ready' if scorer.loaded else self._state

    def busy(self, scorer):
        return bool(scorer.loaded and (self._gate.locked() or self._image_tags.locked()))

    def busy_seconds(self):
        return round(time.monotonic()-self._started_at,3) if self._started_at is not None else 0.

    def warmup(self, scorer):
        if scorer.loaded or time.monotonic()<self._retry_at or not self._gate.acquire(blocking=False):
            return
        # 다른 로더가 첫 검사와 슬롯 획득 사이에 끝난 경우 재시작하지 않습니다.
        if scorer.loaded or time.monotonic()<self._retry_at:
            self._gate.release();return
        self._state='loading'
        def load():
            try:
                scorer.load()
                if not scorer.loaded:raise RuntimeError('Model load incomplete')
                self._state='ready'
            except Exception:
                self._state='failed'
                self._retry_at=time.monotonic()+5
                log.exception('모델 로딩 실패; 다음 요청의 재시도까지 최소5초 대기')
            finally:
                self._gate.release()
        try:
            self._loader=threading.Thread(target=load,daemon=True)
            self._loader.start()
        except Exception:
            self._state='failed';self._retry_at=time.monotonic()+5;self._gate.release()
            log.exception('모델 로딩 스레드를 시작하지 못했습니다')

    @contextmanager
    def slot(self, scorer, *, image_tags=False):
        if not scorer.loaded:
            self.warmup(scorer)
            raise HTTPException(503,detail='분석 모델을 준비 중이에요. 잠시 후 다시 시도해 주세요.',headers={'Retry-After':'5'})
        gate = self._image_tags if image_tags else self._gate
        if not gate.acquire(blocking=False):
            raise HTTPException(429,detail='다른 분석을 진행 중이에요. 잠시 후 다시 시도해 주세요.',headers={'Retry-After':'1'})
        if not image_tags:
            self._started_at=time.monotonic()
        try:
            yield
        finally:
            # 클라이언트가 timeout이어도 실제 추론이 끝날 때까지 슬롯을 유지합니다.
            if not image_tags:
                self._started_at=None
            gate.release()
