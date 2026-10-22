"""작품 이미지 URL 다운로드 (형식·크기·시간 제한)"""
from __future__ import annotations

import io

import httpx
from PIL import Image

from . import config


class ImageFetchError(Exception):
    pass


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
    try:
        img = Image.open(io.BytesIO(bytes(buf)))
        img.load()
        return img.convert("RGB")
    except Exception as e:  # PIL은 형식에 따라 다양한 예외를 던진다
        raise ImageFetchError("이미지 파일을 열 수 없어요.") from e
