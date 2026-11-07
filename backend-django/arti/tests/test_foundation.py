import hashlib
import io
import os
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from arti.models import Account, Artwork, Exhibition, Session, Visit


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class FoundationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.media_override = override_settings(MEDIA_ROOT=Path(cls.temp.name))
        cls.media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        cls.media_override.disable()
        cls.temp.cleanup()
        super().tearDownClass()

    @classmethod
    def setUpTestData(cls):
        call_command('load_test_fixture', stdout=io.StringIO())

    def setUp(self):
        self.client = APIClient(HTTP_HOST='localhost')

    def admin(self):
        account = Account.objects.create(login_id='test-reviewer', nickname='test', role='admin', password=make_password('test-only-strong-password12'))
        token = 'synthetic-admin-token'
        Session.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(), account=account, expires_at=timezone.now()+timedelta(days=1))
        self.client.credentials(HTTP_X_ADMIN_TOKEN=token)
        return account

    def recommend(self, **extra):
        payload = {'exhibitionId': 'fixture-ex01', 'tastes': ['landscape', 'warm'], 'duration': '30m', **extra}
        return self.client.post('/api/recommendations', payload, format='json')

    def test_database_is_actual_postgres(self):
        self.assertEqual(connection.vendor, 'postgresql')

    def test_fixture_is_repeatable_without_accounts(self):
        ids = list(Artwork.objects.values_list('id', flat=True))
        call_command('load_test_fixture', stdout=io.StringIO())
        self.assertEqual(ids, list(Artwork.objects.values_list('id', flat=True)))
        self.assertEqual(Exhibition.objects.count(), 2)
        self.assertEqual(Artwork.objects.count(), 13)
        self.assertEqual(Account.objects.count(), 0)

    def test_production_refuses_test_fixture_even_with_flag(self):
        with override_settings(ARTI_ENV='production', ALLOW_TEST_FIXTURES=True), self.assertRaises(CommandError):
            call_command('load_test_fixture', stdout=io.StringIO())

    def test_flag_is_required_for_development_fixture(self):
        with override_settings(ALLOW_TEST_FIXTURES=False), self.assertRaises(CommandError):
            call_command('load_test_fixture', stdout=io.StringIO())

    def test_no_default_accounts_or_sessions(self):
        self.assertEqual(Account.objects.count(), 0)
        self.assertEqual(Session.objects.count(), 0)

    def test_bootstrap_hashes_and_never_overwrites(self):
        out = io.StringIO()
        with patch.dict(os.environ, {'ARTI_BOOTSTRAP_PASSWORD': 'only-test-password123'}):
            call_command('bootstrap_admin', login_id='explicit-admin', name='reviewer', stdout=out)
            before = Account.objects.get(login_id='explicit-admin').password
            self.assertNotEqual(before, 'only-test-password123')
            with self.assertRaises(CommandError):
                call_command('bootstrap_admin', login_id='explicit-admin', name='reviewer', stdout=out)
            self.assertEqual(Account.objects.get(login_id='explicit-admin').password, before)
            self.assertNotIn('only-test-password123', out.getvalue())

    def test_bootstrap_rejects_weak_password(self):
        with patch.dict(os.environ, {'ARTI_BOOTSTRAP_PASSWORD': 'admin1234'}), self.assertRaises(CommandError):
            call_command('bootstrap_admin', login_id='weak', name='test', stdout=io.StringIO())
        self.assertEqual(Account.objects.count(), 0)

    def test_public_exhibition_policy_and_camel_case(self):
        rows = self.client.get('/api/exhibitions').json()
        self.assertEqual([r['id'] for r in rows], ['fixture-ex01'])
        self.assertEqual(rows[0]['startDate'], '2026-01-01')
        self.assertEqual(rows[0]['entrance'], {'x': 0, 'y': 0})
        for status in ('draft', 'closed'):
            Exhibition.objects.filter(pk='fixture-draft').update(status=status)
            self.assertEqual(self.client.get('/api/exhibitions/fixture-draft').status_code, 404)

    def test_pending_and_draft_artwork_hidden_in_all_public_reads(self):
        for work_id in ('fixture-art11', 'fixture-art13'):
            self.assertEqual(self.client.get('/api/artworks/'+work_id).status_code, 404)
            self.assertEqual(self.client.post('/api/artworks/'+work_id+'/ask', {'question': 'test'}, format='json').status_code, 404)
        ids = {w['id'] for w in self.client.get('/api/artworks').json()}
        self.assertNotIn('fixture-art11', ids)
        self.assertNotIn('fixture-art13', ids)
        self.assertEqual(self.client.get('/api/artworks?exhibitionId=fixture-draft').status_code, 404)

    def test_public_dto_removes_suggested_content_with_ui_safe_defaults(self):
        data = self.client.get('/api/artworks/fixture-art01').json()
        for key, expected in {'summary': '', 'summaryKeywords': [], 'summaryStatus': 'none',
                              'guideIntro': '', 'guidedLooking': [], 'guidedHints': [], 'guideStatus': 'none',
                              'analysis': None, 'emotionStatus': 'none', 'tagScores': None}.items():
            self.assertEqual(data[key], expected)
        self.assertNotIn('미검수', str(data))
        self.assertEqual(data['year'], '연도 미상')
        self.assertIn('contentVersion', data)
        self.assertEqual(self.client.get('/api/artworks/fixture-art01')['ETag'], '"1"')

    def test_admin_reads_retain_drafts_and_suggested_text(self):
        self.assertEqual(self.client.get('/api/admin/artworks').status_code, 401)
        self.admin()
        self.assertEqual(len(self.client.get('/api/admin/artworks').json()), 13)
        self.assertEqual(len(self.client.get('/api/admin/exhibitions').json()), 2)
        data = self.client.get('/api/admin/artworks/fixture-art01').json()
        self.assertEqual(data['summaryStatus'], 'suggested')
        self.assertIn('미검수', data['summary'])

    def test_role_specific_opaque_token_and_logout(self):
        account = self.admin()
        out = self.client.post('/api/admin/login', {'id': account.login_id, 'password': 'test-only-strong-password12'}, format='json')
        self.assertEqual(out.status_code, 200)
        token = out.json()['token']
        self.assertFalse(Session.objects.filter(token_hash=token).exists())
        self.client.credentials(HTTP_AUTHORIZATION='Bearer '+token)
        self.assertEqual(self.client.get('/api/admin/artworks').status_code, 401)
        self.client.credentials(HTTP_X_ADMIN_TOKEN=token)
        self.assertEqual(self.client.post('/api/admin/logout').status_code, 204)
        self.assertEqual(self.client.get('/api/admin/artworks').status_code, 401)

    def test_media_permissions_and_public_show_image(self):
        self.assertEqual(self.client.get('/api/uploads/fixture-public.png').status_code, 200)
        self.assertEqual(self.client.get('/api/uploads/fixture-private.png').status_code, 404)
        data = self.client.get('/api/artworks/fixture-art12').json()
        self.assertEqual(data['imageFile'], None)
        self.assertEqual(data['imageUrl'], '')
        self.admin()
        self.assertEqual(self.client.get('/api/admin/uploads/fixture-private.png').status_code, 200)

    def test_recommendation_response_shape_duration_and_exclusions(self):
        for duration, count in [('30m', 3), ('60m', 5), ('relaxed', 7)]:
            data = self.recommend(duration=duration).json()
            self.assertEqual(len(data), count)
            self.assertEqual([r['order'] for r in data], list(range(1, count+1)))
            self.assertTrue(all(set(r) == {'artworkId', 'order', 'reason', 'matchedTags', 'matchedCard', 'score', 'aiTags'} for r in data))
            self.assertNotIn('fixture-art11', [r['artworkId'] for r in data])
            self.assertNotIn('fixture-art12', [r['artworkId'] for r in data])

    def test_pool_exact_ten_or_explicit_not_ready(self):
        data = self.client.get('/api/exhibitions/fixture-ex01/taste-pool').json()
        self.assertTrue(data['ready'])
        self.assertEqual(len(data['pairs']), 5)
        Artwork.objects.filter(pk='fixture-art10').update(show_image=False)
        data = self.client.get('/api/exhibitions/fixture-ex01/taste-pool').json()
        self.assertFalse(data['ready'])
        self.assertEqual(data['pairs'], [])

    def test_counts_computed_from_server_not_client_and_weighted(self):
        chosen_tags = [['landscape'], ['landscape'], ['warm'], ['soft'], ['soft']]
        for i, tags in enumerate(chosen_tags):
            Artwork.objects.filter(pk=f'fixture-art{i*2+1:02}').update(tags=tags)
        pool = self.client.get('/api/exhibitions/fixture-ex01/taste-pool').json()
        profile = {'version': 1, 'source': 'picks', 'poolVersion': pool['poolVersion'],
                   'picks': [{'pairIndex': i, 'artworkId': p['leftId']} for i, p in enumerate(pool['pairs'])],
                   'selectedTags': ['landscape', 'warm'], 'counts': {'landscape': 0, 'warm': 5}}
        out = self.recommend(tasteProfile=profile, duration='relaxed')
        self.assertEqual(out.status_code, 200)
        scores = {r['artworkId']: r['score'] for r in out.json()}
        self.assertEqual(scores['fixture-art01'], .667)
        self.assertEqual(scores['fixture-art02'], .333)
        profile['poolVersion'] = 'outdated'
        self.assertEqual(self.recommend(tasteProfile=profile).status_code, 409)

    def test_invalid_profile_returns_400_not_500(self):
        for tags in [[{}], ['not-a-tag'], ['warm', 'warm']]:
            out = self.recommend(tasteProfile={'version': 1, 'source': 'manual', 'selectedTags': tags})
            self.assertEqual(out.status_code, 400)
        self.assertEqual(self.recommend(tastes=['warm', 'warm']).status_code, 400)

    def test_saved_profile_requires_authenticated_owner(self):
        out = self.recommend(tasteProfile={'version': 1, 'source': 'saved', 'savedProfileVersion': 1, 'selectedTags': ['landscape', 'warm']})
        self.assertEqual(out.status_code, 401)

    def test_coverage_counts_positioned_approved_only(self):
        data = self.client.get('/api/exhibitions/fixture-ex01/tag-coverage').json()
        self.assertEqual(data['landscape'], 5)
        self.assertEqual(data['warm'], 5)
        self.assertEqual(set(data), set(('landscape','people','abstract','light','vivid','cool','warm','soft')))

    def test_database_constraints_enforce_coordinates_status_and_dates(self):
        for patch_values in [{'position_x': 101}, {'position_x': None, 'position_y': 3}, {'review_status': 'fake'}, {'version': 0}]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                Artwork.objects.filter(pk='fixture-art01').update(**patch_values)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Exhibition.objects.filter(pk='fixture-ex01').update(end_date='2025-01-01')

    def test_fk_json_null_and_timezone_round_trip(self):
        work = Artwork.objects.get(pk='fixture-art12')
        self.assertIsNone(work.position_x)
        self.assertIsNone(work.analysis)
        self.assertIsInstance(work.tags, list)
        self.assertTrue(timezone.is_aware(work.updated_at))
        self.assertEqual(work.year, '연도 미상')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Artwork.objects.filter(pk=work.id).update(exhibition_id='missing-exhibition')
            connection.check_constraints()

    def test_visit_identity_has_real_database_unique_constraint(self):
        user = Account.objects.create(login_id='owner', role='user', password='!')
        values = {'user': user, 'visit_id': uuid.uuid4(), 'exhibition_id': 'fixture-ex01'}
        Visit.objects.create(**values)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Visit.objects.create(**values)

    def test_model_clean_rejects_foreign_room_and_mismatched_hints(self):
        work = Artwork.objects.get(pk='fixture-art01')
        work.room_id = 'not-this-exhibition'
        with self.assertRaises(ValidationError):
            work.full_clean()
        work.room_id = 'room-1'
        work.guided_hints = []
        with self.assertRaises(ValidationError):
            work.full_clean()

    def test_health_readiness_and_unimplemented_are_honest(self):
        self.assertEqual(self.client.get('/api/health').json()['ai'], 'not-connected')
        self.assertEqual(self.client.get('/api/ready').status_code, 200)
        self.assertEqual(self.client.post('/api/artworks/fixture-art01/ask', {'question':'test'}, format='json').status_code, 501)
        self.assertEqual(self.client.post('/api/visits', {}, format='json').status_code, 501)
        missing = self.client.get('/api/nonexistent')
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(set(missing.json()), {'error', 'code', 'retryable', 'requestId'})
