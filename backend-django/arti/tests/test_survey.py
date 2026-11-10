# 전시 독립 조사·공개 경계·버전·이전 저장 호환을 실제 PostgreSQL에서 검증합니다.
import copy
import hashlib
import io
import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from arti.models import Account, Artwork, Exhibition, Session, SurveyEntry, SurveyPool


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class SurveyTests(TestCase):
    def setUp(self):
        cache.clear()
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        settings = override_settings(MEDIA_ROOT=self.root)
        settings.enable()
        self.addCleanup(settings.disable)
        call_command('load_test_fixture', stdout=io.StringIO())
        self.client = APIClient(HTTP_HOST='localhost')

    def pool(self):
        response = self.client.get('/api/taste-pool')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def profile(self):
        pool = self.pool()
        return {'version': 1, 'source': 'picks', 'poolVersion': pool['poolVersion'],
                'selectedTags': ['landscape'], 'counts': {'landscape': 0},
                'picks': [{'pairIndex': i, 'artworkId': p['leftId']} for i, p in enumerate(pool['pairs'])]}

    def recommend(self, profile=None, exhibition='fixture-ex01'):
        return self.client.post('/api/recommendations', {
            'exhibitionId': exhibition, 'tastes': ['landscape'], 'duration': '30m',
            'tasteProfile': profile if profile is not None else self.profile()
        }, format='json')

    def configure(self, **changes):
        manifest = {'id': 'curated', 'name': '합성 조사',
                    'artworkIds': [f'fixture-art{i:02}' for i in range(1, 11)], **changes}
        path = self.root/'manifest.json'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        return path

    def test_two_exhibitions_share_survey_but_recommend_only_own_artworks(self):
        Exhibition.objects.filter(pk='fixture-draft').update(status='running')
        Artwork.objects.filter(pk='fixture-art13').update(position_x=20, position_y=30)
        a = self.client.get('/api/exhibitions/fixture-ex01/taste-pool').json()
        b = self.client.get('/api/exhibitions/fixture-draft/taste-pool').json()
        self.assertEqual(a, b)
        self.assertEqual(a, self.pool())
        profile = self.profile()
        for ex in ('fixture-ex01', 'fixture-draft'):
            response = self.recommend(profile, ex)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertTrue(response.json(), '분리 검증은 빈 추천 결과로 통과할 수 없습니다.')
            for result in response.json():
                self.assertEqual(Artwork.objects.get(pk=result['artworkId']).exhibition_id, ex)

    def test_draft_origin_and_no_coordinates_are_valid_only_for_survey(self):
        Artwork.objects.filter(id__in=[f'fixture-art{i:02}' for i in range(1, 11)]).update(
            exhibition_id='fixture-draft', position_x=None, position_y=None, image_file='survey-only.png')
        Exhibition.objects.filter(pk='fixture-draft').update(status='draft')
        (self.root/'survey-only.png').write_bytes(b'synthetic-image')
        self.assertTrue(self.pool()['ready'])
        image = self.client.get('/api/uploads/survey-only.png')
        self.assertEqual(image.status_code, 200)
        # TestCase의 외부 트랜잭션을 닫는 request_finished만 차단하고 스트림은 정상 정리합니다.
        with patch('django.core.signals.request_finished.send'):
            image.close()
        self.assertEqual(self.client.get('/api/artworks/fixture-art01').status_code, 404)
        self.assertEqual(self.client.get('/api/artworks?exhibitionId=fixture-draft').status_code, 404)
        self.assertEqual(self.recommend().status_code, 200)
        Artwork.objects.filter(pk='fixture-art01').update(tag_status='none')
        self.assertEqual(self.client.get('/api/uploads/survey-only.png').status_code, 404)
        SurveyPool.objects.update(active=False)
        self.assertEqual(self.client.get('/api/uploads/survey-only.png').status_code, 404)

    def test_any_ineligible_entry_hides_entire_pool_and_invalidates_picks(self):
        profile = self.profile()
        original = Artwork.objects.get(pk='fixture-art10')
        for change in ({'review_status': 'source_check'}, {'show_image': False},
                       {'tag_status': 'suggested'}, {'tags': []}, {'image_file': None, 'image_url': ''}):
            with self.subTest(change=change):
                Artwork.objects.filter(pk=original.id).update(**change)
                pool = self.pool()
                self.assertFalse(pool['ready'])
                self.assertEqual(pool['pairs'], [])
                self.assertEqual(pool['artworks'], [])
                self.assertEqual(self.recommend(profile).status_code, 409)
                original.save()

    def test_missing_entries_and_no_active_pool_do_not_fallback(self):
        SurveyEntry.objects.filter(position=9).delete()
        self.assertFalse(self.pool()['ready'])
        SurveyPool.objects.update(active=False)
        self.assertEqual(self.pool()['artworks'], [])
        self.assertIsNone(self.pool()['poolId'])

    def test_version_changes_with_revision_order_and_source_membership(self):
        profile = self.profile()
        SurveyPool.objects.filter(active=True).update(revision=2)
        self.assertNotEqual(self.pool()['poolVersion'], profile['poolVersion'])
        self.assertEqual(self.recommend(profile).status_code, 409)
        before = self.pool()['poolVersion']
        Artwork.objects.filter(pk='fixture-art01').update(exhibition_id='fixture-draft')
        self.assertNotEqual(self.pool()['poolVersion'], before)

    def test_invalid_selections_and_unearned_tags_are_rejected(self):
        base = self.profile()
        for variant in ('duplicate', 'wrong_pair', 'missing', 'outside'):
            profile = copy.deepcopy(base)
            if variant == 'duplicate': profile['picks'][1] = profile['picks'][0]
            if variant == 'wrong_pair': profile['picks'][0]['artworkId'] = 'fixture-art03'
            if variant == 'missing': profile['picks'].pop()
            if variant == 'outside': profile['picks'][0]['artworkId'] = 'fixture-art12'
            self.assertEqual(self.recommend(profile).status_code, 400, variant)
        base['selectedTags'] = ['people']
        response = self.client.post('/api/recommendations', {
            'exhibitionId': 'fixture-ex01', 'tastes': ['people'], 'duration': '30m', 'tasteProfile': base
        }, format='json')
        self.assertEqual(response.status_code, 400)

    def test_legacy_saved_snapshot_survives_new_pool_and_forged_counts(self):
        legacy = {'version': 1, 'source': 'picks', 'poolVersion': 'old-exhibition-pool',
                  'counts': {'landscape': 3}, 'selectedTags': ['landscape'],
                  'originExhibitionId': 'legacy-ex', 'originalPicks': [{'pairIndex': 0, 'artworkId': 'legacy'}]}
        account = Account.objects.create(login_id='saved', role='user', password='unused', tastes=['landscape'], taste_profile=legacy)
        Session.objects.create(token_hash=hashlib.sha256(b'saved-token').hexdigest(), account=account,
                               expires_at=timezone.now()+timedelta(days=1))
        self.client.credentials(HTTP_AUTHORIZATION='Bearer saved-token')
        SurveyPool.objects.update(active=False)
        profile = {'version': 1, 'source': 'saved', 'selectedTags': ['landscape'],
                   'savedProfileVersion': account.taste_profile_version, 'counts': {'people': 5}}
        self.assertEqual(self.recommend(profile).status_code, 200)
        account.refresh_from_db()
        self.assertEqual(account.taste_profile, legacy)
        profile['savedProfileVersion'] += 1
        self.assertEqual(self.recommend(profile).status_code, 409)
        self.client.credentials()
        profile['savedProfileVersion'] -= 1
        self.assertEqual(self.recommend(profile).status_code, 401)

    def test_new_saved_snapshot_records_survey_origin_and_server_counts(self):
        account = Account.objects.create(login_id='new-saved', role='user', password='unused')
        Session.objects.create(token_hash=hashlib.sha256(b'new-token').hexdigest(), account=account,
                               expires_at=timezone.now()+timedelta(days=1))
        self.client.credentials(HTTP_AUTHORIZATION='Bearer new-token')
        profile = self.profile()
        response = self.client.put(f'/api/users/{account.id}/tastes', {
            'tastes': ['landscape'], 'tasteProfile': profile, 'exhibitionId': 'fixture-ex01'
        }, format='json')
        self.assertEqual(response.status_code, 204, response.content)
        account.refresh_from_db()
        self.assertEqual(account.taste_profile['originSurveyId'], 'fixture-survey')
        self.assertEqual(account.taste_profile['counts']['landscape'], 5)

    def test_command_explicit_order_atomic_errors_and_revision(self):
        ids = [f'fixture-art{i:02}' for i in range(10, 0, -1)]
        path = self.configure(artworkIds=ids)
        call_command('configure_taste_survey', manifest=str(path), expected_revision=0, activate=True, stdout=io.StringIO())
        self.assertEqual([w['id'] for w in self.pool()['artworks']], ids)
        before = self.pool()
        for revision, bad_ids in ((0, ids), (1, ['missing']+ids[1:]),
                                  (1, ['fixture-art11']+ids[1:]), (1, [ids[0]]*10)):
            path = self.configure(artworkIds=bad_ids)
            with self.assertRaises(CommandError):
                call_command('configure_taste_survey', manifest=str(path), expected_revision=revision, activate=True)
            self.assertEqual(self.pool(), before)
        path = self.configure(artworkIds=ids)
        call_command('configure_taste_survey', manifest=str(path), expected_revision=1, stdout=io.StringIO())
        self.assertFalse(self.pool()['ready'])

    def test_constraints_reject_second_active_duplicate_artwork_and_position(self):
        pool = SurveyPool.objects.get(active=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            SurveyPool.objects.create(id='second', name='second', active=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            SurveyEntry.objects.create(pool=pool, artwork_id='fixture-art01', position=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            SurveyEntry.objects.create(pool=pool, artwork_id='fixture-art12', position=10)
