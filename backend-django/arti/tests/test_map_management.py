# 관리자 도면·배치 저장과 전시 격리·추천 연결을 검증합니다.
"""Administrator map workflow on isolated fixture data, never the Yoo intake corpus."""
from django.test import TestCase, override_settings
from arti.models import Artwork, Exhibition
from arti.indoor import can_walk
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

    def test_current_artwork_cannot_be_placed_using_an_older_map(self):
        older = self.upload(self.ex.version).json()
        current = self.upload(older['version']).json()
        work = Artwork.objects.get(pk='fixture-art01')
        point = {'x': 21, 'y': 34}
        rejected = self.put(work, position=point, mapVersion=older['version'])
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()['code'], 'VERSION_CONFLICT')
        self.assertIsNone(Artwork.objects.get(pk=work.pk).position_x)
        self.assertEqual(self.public.post('/api/recommendations', {
            'exhibitionId': self.ex.id, 'duration': '30m', 'tastes': [],
        }, format='json').json(), [])
        saved = self.put(work, position=point, mapVersion=current['version'])
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(self.public.get('/api/artworks/' + work.id).json()['position'], point)

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

    def save_layout(self, exhibition, layout, **overrides):
        return self.admin.put(self.path + '/navigation', {
            'version': exhibition['version'], 'floorPlanRevision': exhibition['floorPlanRevision'],
            'layout': layout, **overrides,
        }, format='json')

    def test_layout_is_bound_to_the_plan_and_rejects_stale_edits(self):
        plan = self.upload(self.ex.version).json()
        layout = {'walkable': [{'x': 4, 'y': 4, 'w': 92, 'h': 92}],
                  'walls': [], 'pillars': [{'x': 40, 'y': 35, 'w': 20, 'h': 30}],
                  'doors': [], 'corridors': [], 'waypoints': [{'x': 36, 'y': 31}]}
        self.assertEqual(self.public.put(self.path + '/navigation', {}, format='json').status_code, 401)
        self.assertEqual(self.admin.put(self.path + '/navigation', ['layout'], format='json').status_code, 400)
        self.assertEqual(self.save_layout(plan, {**layout, 'walls': [{'x': 99, 'y': 1, 'w': 2, 'h': 10}]}).status_code, 400)
        response = self.save_layout(plan, layout)
        self.assertEqual(response.status_code, 200, response.content)
        saved = response.json()
        expected = {**layout, 'aspect': 1.5, 'floorPlanRevision': plan['floorPlanRevision']}
        self.assertEqual(saved['navigationLayout'], expected)
        self.assertEqual(self.public.get('/api/exhibitions/' + self.ex.id).json()['navigationLayout'], expected)
        self.assertEqual(self.save_layout(plan, layout).status_code, 409)
        renamed = self.admin.put(self.path, {**saved, 'title': '이름을 바꾼 합성 전시'}, format='json').json()
        self.assertEqual(renamed['navigationLayout'], expected)
        replacement = self.upload(renamed['version']).json()
        self.assertEqual(replacement['floorPlanRevision'], saved['floorPlanRevision'] + 1)
        self.assertIsNone(replacement['navigationLayout'])
        self.assertEqual(self.save_layout(replacement, layout, floorPlanRevision=plan['floorPlanRevision']).status_code, 409)

    @override_settings(ARTI_TASTE_PROFILE_V2_ENABLED=True)
    def test_corridor_order_preserves_v2_recommendations_at_each_duration(self):
        self.ex.entrance_x, self.ex.entrance_y = 42, 20
        self.ex.save(update_fields=['entrance_x', 'entrance_y'])
        works = Artwork.objects.filter(exhibition=self.ex)
        works.update(position_x=None, position_y=None, tag_status='none', tags=['warm'])
        points = [(58, 20), (24, 45), (70, 54), (18, 55), (23, 58), (30, 65), (80, 42)]
        for index, (x, y) in enumerate(points, start=1):
            works.filter(pk=f'fixture-art{index:02}').update(position_x=x, position_y=y)

        def rect(x, y, w, h):
            return {'x': x, 'y': y, 'w': w, 'h': h}

        layout = {
            'walkable': [rect(4, 4, 42, 68), rect(54, 4, 42, 68)],
            'walls': [rect(46, 4, 8, 70), rect(4, 72, 32, 2), rect(44, 72, 2, 2),
                      rect(54, 72, 2, 2), rect(64, 72, 32, 2)],
            'pillars': [rect(30, 28, 6, 8)], 'corridors': [rect(4, 74, 92, 22)],
            'doors': [rect(36, 71, 8, 4), rect(56, 71, 8, 4)],
            'waypoints': [{'x': x, 'y': y} for x, y in [(40, 70), (40, 76), (40, 85), (60, 85), (60, 76), (60, 70)]],
        }

        def recommend(duration):
            response = self.public.post('/api/recommendations', {
                'exhibitionId': self.ex.id, 'duration': duration, 'tastes': ['warm'],
                'tasteProfile': {'version': 2, 'source': 'manual', 'selectedTags': ['warm']},
            }, format='json')
            self.assertEqual(response.status_code, 200, response.content)
            return response.json()

        def selected(items):
            return {item['artworkId']: {key: value for key, value in item.items() if key != 'order'} for item in items}

        durations = {'30m': 3, '60m': 5, 'relaxed': 7}
        baseline = {duration: recommend(duration) for duration in durations}
        saved = self.save_layout(exhibition_dto(self.ex), layout)
        self.assertEqual(saved.status_code, 200, saved.content)
        for duration, count in durations.items():
            with self.subTest(duration=duration):
                actual = recommend(duration)
                self.assertEqual(len(actual), count)
                self.assertEqual(selected(actual), selected(baseline[duration]))
                self.assertEqual([item['order'] for item in actual], list(range(1, count + 1)))
                self.assertEqual(baseline[duration][0]['artworkId'], 'fixture-art01')
                self.assertNotEqual(actual[0]['artworkId'], 'fixture-art01')
        sealed = self.save_layout(saved.json(), {**layout, 'doors': []})
        self.assertEqual(sealed.status_code, 200, sealed.content)
        for duration in durations:
            self.assertEqual(recommend(duration), baseline[duration])

    def test_pillar_corner_contact_and_gap_are_blocked(self):
        room = {'x': 4, 'y': 4, 'w': 92, 'h': 92}
        pillar = {'x': 40, 'y': 35, 'w': 20, 'h': 30}
        self.assertFalse(can_walk((15, 35), (85, 35), [room], [pillar]))
        self.assertTrue(can_walk((15, 34), (85, 34), [room], [pillar]))
        self.assertFalse(can_walk((5, 5), (20, 5), [
            {'x': 4, 'y': 4, 'w': 5, 'h': 5}, {'x': 12, 'y': 4, 'w': 10, 'h': 5},
        ], []))
