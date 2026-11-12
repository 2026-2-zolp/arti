# 관리자 도면·배치 저장과 전시 격리·추천 연결을 검증합니다.
"""Administrator map workflow on isolated fixture data, never the Yoo intake corpus."""
from django.test import TestCase, override_settings
from arti.models import Artwork, Exhibition
from arti.serializers import exhibition_dto
from .test_integration import Helpers


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class MapManagementTests(Helpers, TestCase):
    def setUp(self):
        self.setup_clients()
        self.ex = Exhibition.objects.get(pk='fixture-ex01')
        self.path = '/api/admin/exhibitions/' + self.ex.id
        self.image_path = self.path + '/floor-plan?width=600&height=400'
        # A real 600x400 PNG; no artwork files or extra imaging dependency.
        import struct
        import zlib
        def chunk(kind, data):
            return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
        self.png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 600, 400, 8, 2, 0, 0, 0))
                    + chunk(b'IDAT', zlib.compress((b'\x00' + b'\xff' * 1800) * 400)) + chunk(b'IEND', b''))

    def upload(self, version):
        return self.admin.post(self.image_path, self.png, content_type='image/png', HTTP_IF_MATCH=f'"{version}"')

    def test_upload_requery_and_media_visibility(self):
        response = self.upload(self.ex.version)
        self.assertEqual(response.status_code, 200, response.content)
        saved = response.json()
        self.assertEqual(saved['floorPlan']['width'], 600)
        self.assertEqual(saved['floorPlan']['height'], 400)
        self.assertEqual(self.admin.get(self.path).json()['floorPlan'], saved['floorPlan'])
        filename = saved['floorPlan']['file']
        download = self.public.get('/api/uploads/' + filename)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b''.join(download.streaming_content), self.png)
        self.ex.refresh_from_db()
        self.ex.status = 'draft'; self.ex.save()
        self.assertEqual(self.public.get('/api/uploads/' + filename).status_code, 404)
        private_download = self.admin.get('/api/admin/uploads/' + filename)
        self.assertEqual(private_download.status_code, 200)
        self.assertEqual(b''.join(private_download.streaming_content), self.png)

    def test_same_ratio_replacement_resets_only_target_exhibition(self):
        first = self.upload(self.ex.version)
        self.assertEqual(first.status_code, 200, first.content)
        work = Artwork.objects.get(pk='fixture-art01')
        saved = self.put(work, position={'x': 22, 'y': 33})
        self.assertEqual(saved.status_code, 200, saved.content)
        other = Exhibition.objects.create(title='Other synthetic exhibition', start_date='2026-01-01', end_date='2026-12-31')
        foreign = Artwork.objects.create(exhibition=other, title='Other synthetic work', artist='Fixture', position_x=5, position_y=6)
        old_source = work.source_version
        second = self.upload(first.json()['version'])
        self.assertEqual(second.status_code, 200, second.content)
        self.assertNotEqual(first.json()['floorPlan']['file'], second.json()['floorPlan']['file'])
        work.refresh_from_db(); foreign.refresh_from_db()
        self.assertIsNone(work.position_x); self.assertIsNone(work.position_y)
        self.assertEqual(work.source_version, old_source)
        self.assertEqual((foreign.position_x, foreign.position_y), (5, 6))
        # Retired image is not available via the public endpoint.
        self.assertEqual(self.public.get('/api/uploads/' + first.json()['floorPlan']['file']).status_code, 404)

    def test_stale_upload_is_rejected_without_losing_placement(self):
        result = self.upload(self.ex.version)
        self.assertEqual(result.status_code, 200, result.content)
        work = Artwork.objects.get(pk='fixture-art01')
        self.assertEqual(self.put(work, position={'x': 21, 'y': 34}).status_code, 200)
        stale = self.upload(self.ex.version)
        self.assertEqual(stale.status_code, 409)
        work.refresh_from_db()
        self.assertEqual((work.position_x, work.position_y), (21, 34))
        self.assertEqual(self.admin.get(self.path).json()['floorPlan'], result.json()['floorPlan'])

    def test_rooms_entrance_and_position_roundtrip_and_room_removal_guard(self):
        body = exhibition_dto(self.ex)
        body['rooms'] = [*body['rooms'], {'id': 'review-room', 'name': '검토용 전시실'}]
        body['entrance'] = {'x': 12, 'y': 13}
        result = self.admin.put(self.path, body, format='json')
        self.assertEqual(result.status_code, 200, result.content)
        work = Artwork.objects.get(pk='fixture-art01')
        saved = self.put(work, roomId='review-room', position={'x': 40, 'y': 60})
        self.assertEqual(saved.status_code, 200, saved.content)
        reread = self.admin.get('/api/admin/artworks/' + work.id).json()
        self.assertEqual(reread['roomId'], 'review-room')
        self.assertEqual(reread['position'], {'x': 40, 'y': 60})
        self.assertEqual(self.admin.get(self.path).json()['entrance'], {'x': 12, 'y': 13})
        body = result.json(); body['rooms'] = [r for r in body['rooms'] if r['id'] != 'review-room']
        self.assertEqual(self.admin.put(self.path, body, format='json').status_code, 400)

    def test_delete_plan_clears_positions_and_requires_admin(self):
        first = self.upload(self.ex.version)
        self.assertEqual(first.status_code, 200, first.content)
        work = Artwork.objects.get(pk='fixture-art01')
        self.assertEqual(self.put(work, position={'x': 20, 'y': 30}).status_code, 200)
        self.assertEqual(self.public.delete(self.image_path, HTTP_IF_MATCH=f'"{first.json()["version"]}"').status_code, 401)
        response = self.admin.delete(self.image_path, HTTP_IF_MATCH=f'"{first.json()["version"]}"')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.json()['floorPlan'])
        work.refresh_from_db(); self.assertIsNone(work.position_x)

    def test_saved_positions_drive_recommendation_order_and_clear_on_new_plan(self):
        plan = self.upload(self.ex.version)
        self.assertEqual(plan.status_code, 200, plan.content)
        body = {'exhibitionId': self.ex.id, 'duration': '30m', 'tastes': []}
        self.assertEqual(self.public.post('/api/recommendations', body, format='json').json(), [])
        for artwork_id, point in [('fixture-art01', {'x': 80, 'y': 80}),
                                  ('fixture-art02', {'x': 10, 'y': 10}),
                                  ('fixture-art03', {'x': 50, 'y': 50})]:
            work = Artwork.objects.get(pk=artwork_id)
            result = self.put(work, position=point)
            self.assertEqual(result.status_code, 200, result.content)
        result = self.public.post('/api/recommendations', body, format='json')
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual([r['artworkId'] for r in result.json()], ['fixture-art02', 'fixture-art03', 'fixture-art01'])
        self.assertEqual(self.upload(plan.json()['version']).status_code, 200)
        self.assertEqual(self.public.post('/api/recommendations', body, format='json').json(), [])
