"""회원 목록과 영수증 해석의 실패·재시도 시 저장 기록을 검증합니다."""
import copy
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings

from arti.http import ContractError
from arti.models import Account, Artwork, Exhibition, Visit, VisitReaction
from arti.tests.test_integration import Helpers


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class ReceiptOperationsTests(Helpers, TestCase):
    def setUp(self):
        self.setup_clients()

    def saved_visit(self):
        payload = self.payload()
        response = self.a.post('/api/visits', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        request = {key: payload[key] for key in (
            'exhibitionId', 'visitId', 'viewedArtworkIds', 'reactions', 'dwell')}
        return response.json()['id'], request

    def test_admin_members_include_counts_latest_visit_and_search(self):
        self.saved_visit()
        visit_id, _ = self.saved_visit()
        latest = Visit.objects.get(pk=visit_id).created_at.isoformat()
        # 인증 조회와 목록 집계: 회원 수에 비례해 관람 조회를 반복하지 않습니다.
        with self.assertNumQueries(2):
            response = self.admin.get('/api/admin/members')
        self.assertEqual(response.status_code, 200, response.content)
        members = {row['id']: row for row in response.json()}
        self.assertEqual(set(members), {self.actors[0].id, self.actors[1].id})
        self.assertEqual(members[self.actors[0].id]['visitCount'], 2)
        self.assertEqual(members[self.actors[0].id]['lastVisit'], latest)
        self.assertEqual(members[self.actors[1].id]['visitCount'], 0)
        self.assertIsNone(members[self.actors[1].id]['lastVisit'])
        for row in members.values():
            self.assertFalse({'password', 'token', 'token_hash'}.intersection(row))
        rows = self.admin.get('/api/admin/members', {'q': 'A@example.test'}).json()
        self.assertEqual([row['id'] for row in rows], [self.actors[0].id])
        self.actors[1].nickname = '별도닉네임'
        self.actors[1].save(update_fields=['nickname'])
        rows = self.admin.get('/api/admin/members', {'q': '별도닉네임'}).json()
        self.assertEqual([row['id'] for row in rows], [self.actors[1].id])
        self.assertEqual(self.admin.get('/api/admin/members', {'q': 'no-match'}).json(), [])

    def test_member_list_is_only_available_to_admin(self):
        for client in (self.public, self.a, self.b):
            response = client.get('/api/admin/members')
            self.assertIn(response.status_code, (401, 403))
            self.assertIsInstance(response.json(), dict)

    def test_admin_member_filters_apply_before_pagination(self):
        self.saved_visit()
        Account.objects.filter(pk=self.actors[1].pk).update(status='dormant')
        Account.objects.bulk_create([
            Account(role='user', login_id=f'other-{number}@example.test', email=f'other-{number}@example.test')
            for number in range(12)
        ])
        path = '/api/admin/members'
        active = {'status': 'active', 'limit': 10, 'q': 'example.test'}
        first = self.admin.get(path, active).json()
        second = self.admin.get(path, {**active, 'offset': 10}).json()
        self.assertEqual((first['total'], len(first['items']), len(second['items'])), (13, 10, 3))
        self.assertTrue({row['id'] for row in first['items']}.isdisjoint(row['id'] for row in second['items']))
        with_history = self.admin.get(path, {**active, 'visits': 'with'}).json()
        self.assertEqual(with_history['total'], 1)
        self.assertEqual(with_history['items'][0]['id'], self.actors[0].id)
        dormant = self.admin.get(path, {'status': 'dormant', 'visits': 'without', 'limit': 10}).json()
        self.assertEqual([row['id'] for row in dormant['items']], [self.actors[1].id])
        self.assertEqual(self.admin.get(path, {'visits': 'unknown', 'limit': 10}).status_code, 400)

    def test_admin_member_history_is_scoped_and_works_for_closed_exhibitions(self):
        visit_id, _ = self.saved_visit()
        expected = self.a.get('/api/visits/' + visit_id).json()
        Exhibition.objects.filter(pk='fixture-ex01').update(status='closed')
        url = f'/api/admin/members/{self.actors[0].id}/visits'
        response = self.admin.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), [expected])
        self.assertEqual(self.admin.get(f'/api/admin/members/{self.actors[1].id}/visits').json(), [])
        for user_id in ('missing-member', self.actors[2].id):
            self.assertEqual(self.admin.get(f'/api/admin/members/{user_id}/visits').status_code, 404)
        for client in (self.public, self.a, self.b):
            self.assertIn(client.get(url).status_code, (401, 403))
        # 사용자 경로의 본인 제한은 넓히지 않습니다.
        self.assertEqual(self.b.get(f'/api/users/{self.actors[0].id}/visits').status_code, 403)

    def capture_artwork(self, payload):
        url = '/api/artworks/fixture-art01'
        query = {name: payload[name] for name in ('exhibitionId', 'visitId')}
        response = self.a.get(url, query)
        self.assertEqual(response.status_code, 200)
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertNotIn('artworkReceiptEvidence', self.public.get(url, query).json())
        return response.json()

    def test_first_save_and_replay_use_the_public_snapshot_after_visibility_changes(self):
        for closed in (False, True):
            with self.subTest(closed=closed):
                payload = self.payload()
                captured = self.capture_artwork(payload)
                artwork = Artwork.objects.filter(pk='fixture-art01')
                exhibition = Exhibition.objects.filter(pk='fixture-ex01')
                if closed:
                    exhibition.update(status='closed', title='운영자 전용 전시 이름')
                    self.assertEqual(self.public.get('/api/exhibitions/fixture-ex01').status_code, 404)
                else:
                    artwork.update(review_status='source_check', title='운영자 전용 작품 이름')
                self.assertEqual(self.public.get('/api/artworks/fixture-art01').status_code, 404)
                self.assertEqual(self.a.post('/api/visits', payload, format='json').status_code, 404 if closed else 400)
                payload['artworkReceiptEvidence'] = {'fixture-art01': captured['artworkReceiptEvidence']}
                payload['artworkSnapshots'] = [{'id': 'fixture-art01', 'title': '위조 제목'}]
                created = self.a.post('/api/visits', payload, format='json')
                self.assertEqual(created.status_code, 201, created.content)
                record = created.json()
                self.assertEqual(record['exhibitionTitle'], captured['receiptExhibition']['title'])
                self.assertEqual(record['artworkSnapshots'], [
                    {key: captured[key] for key in ('id', 'title', 'artist', 'year', 'tags')}
                ])
                self.assertNotIn('artworkReceiptEvidence', record)
                for key in ('viewedArtworkIds', 'dwell', 'reactions', 'reactionReasons'):
                    self.assertEqual(record[key], payload[key])
                with patch('arti.records.read_artwork_evidence', return_value=None):
                    replay = self.a.post('/api/visits', payload, format='json')
                    self.assertEqual(replay.status_code, 200, replay.content)
                    self.assertEqual(replay.json(), record)
                self.assertEqual(self.a.get('/api/visits/' + record['id']).json(), record)
                self.assertEqual(self.b.get('/api/visits/' + record['id']).status_code, 403)
                self.assertEqual(Visit.objects.filter(visit_id=payload['visitId']).count(), 1)
                self.assertEqual(VisitReaction.objects.filter(visit_id=record['id']).count(), 1)
                artwork.update(review_status='approved', title=captured['title'])
                exhibition.update(status='running', title=captured['receiptExhibition']['title'])

    def test_artwork_evidence_cannot_be_reused_outside_its_original_scope(self):
        payload = self.payload()
        token = self.capture_artwork(payload)['artworkReceiptEvidence']
        Artwork.objects.filter(pk__in=('fixture-art01', 'fixture-art02')).update(review_status='source_check')
        payload['artworkReceiptEvidence'] = {'fixture-art01': token}
        for client, body in (
            (self.public, payload), (self.b, payload),
            (self.a, {**payload, 'visitId': str(uuid.uuid4())}),
            (self.a, {**payload, 'artworkReceiptEvidence': {'fixture-art01': token + 'tampered'}}),
            (self.a, {
                **payload, 'viewedArtworkIds': ['fixture-art02'],
                'reactions': {}, 'reactionReasons': {}, 'dwell': {},
                'artworkReceiptEvidence': {'fixture-art02': token},
            }),
        ):
            response = client.post('/api/visits', body, format='json')
            self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Visit.objects.exists())

    def test_member_token_cannot_be_used_as_admin_token(self):
        from rest_framework.test import APIClient
        fake_admin = APIClient(HTTP_HOST='localhost', HTTP_X_ADMIN_TOKEN='synthetic-token-a')
        for url in ('/api/admin/members', f'/api/admin/members/{self.actors[0].id}/visits'):
            self.assertEqual(fake_admin.get(url).status_code, 401)

    def test_interpretation_failure_preserves_receipt_then_retry_replaces_only_text(self):
        visit_id, request = self.saved_visit()
        Visit.objects.filter(pk=visit_id).update(interpretation='기존에 성공한 합성 해석')
        before = self.a.get('/api/visits/' + visit_id).json()
        reactions = list(VisitReaction.objects.values())
        for failure in (ContractError(503, 'AI_UNAVAILABLE', '합성 장애'),
                        ContractError(504, 'AI_TIMEOUT', '합성 시간 초과'),
                        {'text': ''}):
            options = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
            with patch('arti.providers.generate', **options):
                response = self.a.post('/api/visits/interpret', request, format='json')
            self.assertIn(response.status_code, (502, 503, 504), response.content)
            self.assertEqual(self.a.get('/api/visits/' + visit_id).json(), before)
        with patch('arti.providers.generate', return_value={'text': '재시도에 성공한 합성 해석'}):
            response = self.a.post('/api/visits/interpret', request, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        expected = {**before, 'interpretation': '재시도에 성공한 합성 해석'}
        self.assertEqual(self.a.get('/api/visits/' + visit_id).json(), expected)
        self.assertEqual(Visit.objects.count(), 1)
        self.assertEqual(list(VisitReaction.objects.values()), reactions)

    def test_wrong_owner_or_changed_receipt_cannot_generate_interpretation(self):
        _, request = self.saved_visit()
        changed = copy.deepcopy(request)
        changed['dwell']['fixture-art01'] += 1
        with patch('arti.providers.generate') as provider:
            self.assertEqual(self.b.post('/api/visits/interpret', request, format='json').status_code, 400)
            self.assertEqual(self.a.post('/api/visits/interpret', changed, format='json').status_code, 400)
            provider.assert_not_called()

    def test_guest_interpretation_does_not_create_member_record(self):
        payload = self.payload()
        request = {key: payload[key] for key in (
            'exhibitionId', 'visitId', 'viewedArtworkIds', 'reactions', 'dwell')}
        with patch('arti.providers.generate', return_value={'text': '비회원 합성 해석'}):
            response = self.public.post('/api/visits/interpret', request, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Visit.objects.exists())
        self.assertFalse(VisitReaction.objects.exists())
