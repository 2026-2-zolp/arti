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

if variant == 'restore':
    exhibition.floor_plan = None
    exhibition.navigation_layout = None
    exhibition.save(update_fields=['floor_plan', 'navigation_layout'])
    call_command('load_test_fixture')
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
        rows = []
        for y in range(height):
            row = bytearray(b'\xff' * width)
            if top <= y * 100 / height <= bottom:
                begin, end = width * left // 100, width * right // 100
                row[begin:end] = b'\x58' * (end - begin)
            rows.append(b'\x00' + row)

        def chunk(kind, data):
            return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))

        filename = f'fixture-map-{variant}.png'
        (settings.MEDIA_ROOT / filename).write_bytes(
            b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
        )
        exhibition.floor_plan = {'file': filename, 'width': width, 'height': height}
    exhibition.save(update_fields=['rooms', 'entrance_x', 'entrance_y', 'floor_plan', 'navigation_layout'])
    works.update(position_x=None, position_y=None, room_id='room-1')
    works.filter(pk='fixture-art03').update(position_x=20, position_y=entrance_y)
    works.filter(pk='fixture-art01').update(position_x=82, position_y=entrance_y,
                                          room_id='room-2' if variant == 'two-rooms' else 'room-1')
    works.filter(pk='fixture-art05').update(position_x=18, position_y=third_y)
