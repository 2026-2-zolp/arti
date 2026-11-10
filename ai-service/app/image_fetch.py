# 모델 서비스: 분석할 이미지의 로딩과 입력 경계를 처리합니다.
"""작품 이미지 읽기: 업로드 파일(base64) 또는 URL 다운로드 (형식·크기·시간 제한)"""
from __future__ import annotations

import base64
import binascii
import io
import hashlib

import httpx
from PIL import Image

from . import config


# 모델 입력 이미지 조회 실패를 구분합니다.
class ImageFetchError(Exception):
    pass


def decode_image(data: bytes) -> Image.Image:
    if len(data) > config.IMAGE_MAX_BYTES:
        raise ImageFetchError("이미지 파일이 너무 커요 (최대 10MB).")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        return img.convert("RGB")
    except Exception as e:  # PIL은 형식에 따라 다양한 예외를 던진다
        raise ImageFetchError("이미지 파일을 열 수 없어요.") from e


def decode_base64_image(b64: str) -> Image.Image:
    return decode_base64_image_with_hash(b64)[0]


def decode_base64_image_with_hash(b64: str) -> tuple[Image.Image, str]:
    """추론에 읽은 원본 바이트를 한 번 디코드하며 기존 이미지 반환 API도 유지합니다."""
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ImageFetchError("이미지 데이터(base64) 형식이 올바르지 않아요.") from e
    return decode_image(data), hashlib.sha256(data).hexdigest()


def fetch_image(url: str) -> Image.Image:
    if not url.startswith(("http://", "https://")):
        raise ImageFetchError("이미지 URL은 http(s)로 시작해야 해요.")
    buf = bytearray()
    try:
        with httpx.stream("GET", url, timeout=config.IMAGE_TIMEOUT_SEC, follow_redirects=True) as res:
            if res.status_code != 200:
                raise ImageFetchError(f"이미지를 내려받지 못했어요 (HTTP {res.status_code}).")
            ctype = res.headers.get("content-type", "")
            if ctype and not ctype.startswith("image/"):
                raise ImageFetchError("URL이 이미지 파일이 아니에요.")
            for chunk in res.iter_bytes():
                buf.extend(chunk)
                if len(buf) > config.IMAGE_MAX_BYTES:
                    raise ImageFetchError("이미지 파일이 너무 커요 (최대 10MB).")
    except httpx.HTTPError as e:
        raise ImageFetchError(f"이미지 주소에 연결할 수 없어요 ({type(e).__name__}).") from e
    return decode_image(bytes(buf))
