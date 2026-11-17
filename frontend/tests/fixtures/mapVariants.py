"""Temporary floor plans for the isolated Chrome fixture."""
import os
import struct
import zlib
from django.conf import settings
from django.core.management import call_command
from arti.models import Artwork, Exhibition
from arti.tests.visit_browser_server import require_visit_fixture

require_visit_fixture()
exhibition = Exhibition.objects.get(pk='fixture-ex01', subtitle='ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION')
variant = os.environ['ARTI_BROWSER_MAP_VARIANT']
works = Artwork.objects.filter(exhibition=exhibition)


def write_plan(filename, width, height, shade):
    rows = [b'\x00' + bytes(shade(x * 100 / width, y * 100 / height) for x in range(width)) for y in range(height)]

    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))

    (settings.MEDIA_ROOT / filename).write_bytes(
        b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 0, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
    )
    return {'file': filename, 'width': width, 'height': height}


if variant == 'restore':
    exhibition.floor_plan = None
    exhibition.navigation_layout = None
    exhibition.save(update_fields=['floor_plan', 'navigation_layout'])
    call_command('load_test_fixture')
elif variant == 'preview':
    exhibition.floor_plan = None
    exhibition.navigation_layout = None
    exhibition.entrance_x, exhibition.entrance_y = 42, 20
    exhibition.save(update_fields=['floor_plan', 'navigation_layout', 'entrance_x', 'entrance_y'])
    works.update(position_x=None, position_y=None, tag_status='none', tags=['warm'])
    positions = [(58, 20), (24, 45), (70, 54), (18, 55), (23, 58), (30, 65), (80, 42)]
    for index, (x, y) in enumerate(positions, start=1):
        works.filter(pk=f'fixture-art{index:02}').update(position_x=x, position_y=y)
elif variant == 'fit':
    def shade(x, y):
        # The reference is inset on a 640 x 360 image. Its two rooms use the same doorway positions as the draft.
        plan_x = 4 + (x - 10) * 92 / 80
        plan_y = 4 + (y - 8) * 92 / 80
        if not (4 <= plan_x <= 96 and 4 <= plan_y <= 96):
            return 255
        if (46 <= plan_x <= 54 and plan_y < 74) or (
            72 <= plan_y < 74 and not (36 < plan_x < 44 or 56 < plan_x < 64)
        ):
            return 88
        return 238

    exhibition.floor_plan = write_plan('fixture-map-fit.png', 640, 360, shade)
    exhibition.navigation_layout = None
    exhibition.entrance_x, exhibition.entrance_y = 19, 26
    exhibition.save(update_fields=['floor_plan', 'navigation_layout', 'entrance_x', 'entrance_y'])
    works.update(position_x=None, position_y=None)
    works.filter(pk='fixture-art03').update(position_x=24, position_y=26)
    works.filter(pk='fixture-art01').update(position_x=78, position_y=26)
    works.filter(pk='fixture-art05').update(position_x=25, position_y=61)
else:
    rooms = [{'id': 'room-1', 'name': '첫 전시실', 'rect': {'x': 4, 'y': 4, 'w': 92, 'h': 92}}]
    entrance_y = 50
    third_y = 72
    if variant == 'two-rooms':
        rooms = [
            {'id': 'room-1', 'name': '첫 전시실', 'rect': {'x': 4, 'y': 4, 'w': 42, 'h': 68}},
            {'id': 'room-2', 'name': '둘째 전시실', 'rect': {'x': 54, 'y': 4, 'w': 42, 'h': 68}},
        ]
        entrance_y = 25
        third_y = 65
    exhibition.rooms = rooms
    exhibition.entrance_x = 12
    exhibition.entrance_y = entrance_y
    exhibition.floor_plan = None
    exhibition.navigation_layout = None
    if variant in ('pillar', 'two-rooms'):
        width, height = (360, 640) if variant == 'pillar' else (640, 360)
        left, top, right, bottom = (40, 35, 60, 65) if variant == 'pillar' else (47, 0, 53, 72)
        exhibition.floor_plan = write_plan(
            f'fixture-map-{variant}.png', width, height,
            lambda x, y: 88 if left <= x < right and top <= y <= bottom else 255,
        )
    exhibition.save(update_fields=['rooms', 'entrance_x', 'entrance_y', 'floor_plan', 'navigation_layout'])
    works.update(position_x=None, position_y=None, room_id='room-1')
    works.filter(pk='fixture-art03').update(position_x=20, position_y=entrance_y)
    works.filter(pk='fixture-art01').update(position_x=82, position_y=entrance_y,
                                          room_id='room-2' if variant == 'two-rooms' else 'room-1')
    works.filter(pk='fixture-art05').update(position_x=18, position_y=third_y)
