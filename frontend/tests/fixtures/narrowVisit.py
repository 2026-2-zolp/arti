"""Extend only the dedicated narrow-screen test database and media."""
from pathlib import Path
import struct
import zlib

from django.conf import settings
from django.db import transaction

from arti.models import Artwork, Exhibition


def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))


def write_png(name, width, height):
    # 색 띠가 있는 세로 도판·도면을 합성해 실제 이미지의 크기와 잘림을 확인합니다.
    rows = b''.join(
        b'\0' + bytes((40 + (y // 40) * 10, 96, 130)) * width
        for y in range(height)
    )
    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(rows))
        + chunk(b'IEND', b'')
    )
    (Path(settings.MEDIA_ROOT) / name).write_bytes(png)


if not (settings.ARTI_ENV == 'test' and settings.ALLOW_TEST_FIXTURES
        and settings.DATABASES['default']['NAME'].startswith('arti_narrow_pc_')):
    raise RuntimeError('Use a disposable arti_narrow_pc_ test database.')

with transaction.atomic():
    exhibition = Exhibition.objects.get(pk='fixture-ex01')
    work = Artwork.objects.get(pk='fixture-art01')
    if not exhibition.subtitle.startswith('ARTI DEVELOPMENT FIXTURE') or work.source != exhibition.subtitle:
        raise RuntimeError('Load the bundled synthetic exhibition first.')
    write_png('fixture-narrow-portrait.png', 160, 320)
    write_png('fixture-narrow-map.png', 320, 640)
    Artwork.objects.filter(pk=work.id).update(
        title='긴 합성 제목 ChromatographicInterrelationshipsInMonochrome',
        image_file='fixture-narrow-portrait.png',
    )
    Exhibition.objects.filter(pk=exhibition.id).update(
        floor_plan={'file': 'fixture-narrow-map.png', 'width': 320, 'height': 640},
    )
