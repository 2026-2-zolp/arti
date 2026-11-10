# 격리 PostgreSQL에서 점수·근거·revision의 원자 저장, 실패·확정·경합과 구조 이관을 검증합니다.
import copy
import json
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import threading
from pathlib import Path
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from arti import editing
from arti.http import ContractError
from arti.models import Artwork
from arti.tag_scores import current_evidence
from arti.tests.test_integration import Helpers
from arti.tests.test_tag_evidence import packet
from arti.tests.test_provider import endpoint


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True, ARTI_LLM_PROVIDER='disabled')
class TagPersistenceTests(Helpers, TransactionTestCase):
    def setUp(self):
        self.setup_clients()
        self.assertEqual(connection.vendor, 'postgresql')
        self.work = Artwork.objects.get(pk='fixture-art01')
        self.work.image_file = 'tp1b.png'
        self.work.tag_status = self.work.emotion_status = 'suggested'
        self.work.save()
        from django.conf import settings
        Path(settings.MEDIA_ROOT, self.work.image_file).write_bytes(b'synthetic-image')

    def snapshot(self):
        self.work.refresh_from_db()
        return copy.deepcopy({k: getattr(self.work, k) for k in
                              ('tag_scores', 'tag_score_evidence', 'tag_score_revision', 'tag_status',
                               'version', 'source_version', 'content_version', 'summary', 'summary_status',
                               'guide_intro', 'guide_status', 'analysis', 'emotion_status')})

    def call(self, **extra):
        return self.admin.post('/api/admin/artworks/'+self.work.id+'/analyze',
                               {'version': self.work.version, **extra}, format='json')

    def valid(self, **extra):
        with endpoint(body=json.dumps(packet()).encode()):
            from django.conf import settings
            with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                return self.call(**extra)

    def test_http_success_atomically_binds_server_input_and_keeps_suggested_private(self):
        before = self.snapshot()
        response = self.valid()
        self.assertEqual(response.status_code, 200, response.content)
        after = self.snapshot()
        self.assertEqual(after['tag_scores'], packet()['tags'])
        self.assertEqual(after['tag_score_revision'], before['tag_score_revision']+1)
        self.assertEqual(after['tag_status'], 'suggested')
        self.assertEqual(after['tag_score_evidence'], packet()['tagEvidence'] | {
            'sourceVersion': before['source_version'], 'inputImageFile': 'tp1b.png'})
        self.assertIsNone(current_evidence(self.work))
        public = self.public.get('/api/artworks/'+self.work.id).json()
        self.assertIsNone(public['tagScores'])
        self.assertNotIn('tagEvidence', public)
        self.assertNotIn('tagScoreEvidence', public)
        self.assertNotIn('tagEvidence', after['analysis'])
        self.assertEqual(self.valid().status_code, 200)
        self.assertEqual(self.snapshot()['tag_score_revision'], before['tag_score_revision']+2)

    def test_confirm_does_not_regenerate_and_unselected_confirmed_values_are_kept(self):
        self.assertEqual(self.valid().status_code, 200)
        self.work.refresh_from_db()
        response = self.admin.post('/api/admin/exhibitions/fixture-ex01/confirm-ai', {
            'items': [{'id': self.work.id, 'version': self.work.version, 'fields': ['tag']}]}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        before = self.snapshot()
        self.assertIsNotNone(current_evidence(self.work))
        with patch('arti.providers.generate', side_effect=ContractError(503, 'AI_UNAVAILABLE', 'synthetic')):
            response = self.call()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.snapshot(), before)
        # 명시적 재생성 성공만 새 revision/suggested로 전환합니다.
        self.assertEqual(self.valid(regenerateFields=['tag']).status_code, 200)
        after = self.snapshot()
        self.assertEqual(after['tag_score_revision'], before['tag_score_revision']+1)
        self.assertEqual(after['tag_status'], 'suggested')

    def test_legacy_missing_or_null_evidence_clears_old_binding_without_inventing_provenance(self):
        for explicit_null in (False, True):
            self.assertEqual(self.valid().status_code, 200)
            before = self.snapshot()
            value = packet()
            if explicit_null: value['tagEvidence'] = None
            else: value.pop('tagEvidence')
            with endpoint(body=json.dumps(value).encode()):
                from django.conf import settings
                with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                    response = self.call()
            self.assertEqual(response.status_code, 200, response.content)
            after = self.snapshot()
            self.assertIsNone(after['tag_score_evidence'])
            self.assertEqual(after['tag_score_revision'], before['tag_score_revision']+1)

    def test_invalid_evidence_and_provider_failures_preserve_complete_bundle(self):
        self.assertEqual(self.valid().status_code, 200)
        before = self.snapshot()
        bad = packet(); bad['tagEvidence']['scoresSha256'] = '0'*64
        cases = [(200, json.dumps(bad).encode(), 502), (429, b'{}', 429), (503, b'{}', 503), (504, b'{}', 502)]
        for status, body, expected in cases:
            with self.subTest(status=status), endpoint(status=status, body=body):
                from django.conf import settings
                with override_settings(ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                    response = self.call()
            self.assertEqual(response.status_code, expected, response.content)
            self.assertEqual(self.snapshot(), before)
        with patch('arti.providers.generate', side_effect=ContractError(504, 'AI_TIMEOUT', 'synthetic')):
            self.assertEqual(self.call().status_code, 504)
        self.assertEqual(self.snapshot(), before)

    def test_failed_tag_allows_existing_independent_partial_summary_policy(self):
        self.assertEqual(self.valid().status_code, 200)
        before = self.snapshot()
        self.work.summary_status = 'suggested'; self.work.save()
        def generate(kind, *args, **kwargs):
            if kind == 'summary': return {'summary': '합성 새 초안', 'keywords': []}
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.providers.generate', side_effect=generate):
            response = self.call()
        self.assertEqual(response.status_code, 200, response.content)
        after = self.snapshot()
        self.assertEqual(after['summary'], '합성 새 초안')
        for field in ('tag_scores', 'tag_score_evidence', 'tag_score_revision', 'tag_status'):
            self.assertEqual(after[field], before[field])

    def test_real_http_timeout_and_late_reply_preserve_previously_bound_scores(self):
        from arti.tests.test_model_operations import service
        self.assertEqual(self.valid().status_code, 200)
        before = self.snapshot()
        with service() as (state, entered, release, completed):
            state['delay'] = True
            with patch('arti.model_service.TIMEOUT_SECONDS', .05): response = self.call()
            self.assertEqual(response.status_code, 504, response.content)
            self.assertTrue(entered.is_set())
            self.assertEqual(state['calls'], 1)
            self.assertEqual(self.snapshot(), before)
            release.set(); self.assertTrue(completed.wait(2))
            self.assertEqual(self.snapshot(), before)

    def test_total_timeout_discards_successful_tag_and_all_other_updates(self):
        before = self.snapshot(); clock = [0]
        def generate(kind, snapshot, **context):
            self.assertFalse(connection.in_atomic_block, '외부 분석 호출 중 행 잠금 금지')
            if kind == 'tag': return {'scores': packet()['tags'], 'tagEvidence': packet()['tagEvidence']}
            if kind == 'emotion': clock[0] = 61
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.budget.monotonic', side_effect=lambda: clock[0]), patch('arti.providers.generate', side_effect=generate):
            response = self.call()
        self.assertEqual(response.status_code, 504, response.content)
        self.assertEqual(self.snapshot(), before)

    def test_database_failure_after_save_rolls_back_entire_bundle(self):
        before = self.snapshot(); original = editing.finish
        def abort(work, old):
            original(work, old)
            raise ContractError(503, 'TEMPORARY_UNAVAILABLE', 'synthetic rollback')
        with patch('arti.editing.finish', side_effect=abort): response = self.valid()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.snapshot(), before)

    def worker_call(self, **extra):
        close_old_connections()
        try:
            client = APIClient(HTTP_HOST='localhost'); client.credentials(**self.admin._credentials)
            return client.post('/api/admin/artworks/'+self.work.id+'/analyze',
                               {'version': self.work.version, **extra}, format='json')
        finally:
            close_old_connections()

    def test_source_edit_during_model_call_wins_and_late_bundle_is_rejected(self):
        before = self.snapshot(); entered = threading.Event(); release = threading.Event()
        def generate(kind, *args, **kwargs):
            self.assertFalse(connection.in_atomic_block)
            entered.set(); self.assertTrue(release.wait(5))
            if kind == 'tag': return {'scores': packet()['tags'], 'tagEvidence': packet()['tagEvidence']}
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.providers.generate', side_effect=generate), ThreadPoolExecutor(1) as pool:
            future = pool.submit(self.worker_call)
            try:
                self.assertTrue(entered.wait(5))
                response = self.put(self.work, description='원문 수정')
                self.assertEqual(response.status_code, 200, response.content)
            finally: release.set()
            self.assertEqual(future.result(5).status_code, 409)
        after = self.snapshot()
        for field in ('tag_scores', 'tag_score_evidence', 'tag_score_revision'):
            self.assertEqual(after[field], before[field])
        self.assertEqual(after['source_version'], before['source_version']+1)

    def test_confirm_during_regeneration_protects_original_confirmed_bundle(self):
        self.assertEqual(self.valid().status_code, 200)
        before = self.snapshot(); entered = threading.Event(); release = threading.Event()
        def generate(kind, *args, **kwargs):
            entered.set(); self.assertTrue(release.wait(5))
            if kind == 'tag': return {'scores': packet()['tags'], 'tagEvidence': packet()['tagEvidence']}
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.providers.generate', side_effect=generate), ThreadPoolExecutor(1) as pool:
            future = pool.submit(self.worker_call)
            try:
                self.assertTrue(entered.wait(5))
                response = self.admin.post('/api/admin/exhibitions/fixture-ex01/confirm-ai', {
                    'items': [{'id': self.work.id, 'version': self.work.version, 'fields': ['tag']}]}, format='json')
                self.assertEqual(response.status_code, 200, response.content)
            finally: release.set()
            self.assertEqual(future.result(5).status_code, 409)
        after = self.snapshot()
        self.assertEqual(after['tag_status'], 'confirmed')
        for field in ('tag_scores', 'tag_score_evidence', 'tag_score_revision'):
            self.assertEqual(after[field], before[field])

    def test_two_completed_analyses_same_version_commit_only_once(self):
        before = self.snapshot(); released = threading.Event(); barrier = threading.Barrier(2)
        real_slot = editing.analysis_slot
        @contextmanager
        def after_release():
            with real_slot(): yield
            # 실제 advisory lock은 유지하고 해제 직후 저장 경쟁만 결정적으로 만듭니다.
            released.set(); barrier.wait(5)
        def generate(kind, *args, **kwargs):
            if kind == 'tag': return {'scores': packet()['tags'], 'tagEvidence': packet()['tagEvidence']}
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.editing.analysis_slot', after_release), patch('arti.providers.generate', side_effect=generate), ThreadPoolExecutor(2) as pool:
            first = pool.submit(self.worker_call)
            self.assertTrue(released.wait(5))
            second = pool.submit(self.worker_call)
            responses = [first.result(8), second.result(8)]
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409])
        after = self.snapshot()
        self.assertEqual(after['tag_score_revision'], before['tag_score_revision']+1)
        self.assertEqual(after['version'], before['version']+1)

    def test_other_connection_never_sees_partially_saved_bundle(self):
        before = self.snapshot(); saved = threading.Event(); release = threading.Event()
        original = editing.finish
        def pause(work, old):
            original(work, old); saved.set(); self.assertTrue(release.wait(5))
        def generate(kind, *args, **kwargs):
            if kind == 'tag': return {'scores': packet()['tags'], 'tagEvidence': packet()['tagEvidence']}
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.editing.finish', side_effect=pause), patch('arti.providers.generate', side_effect=generate), ThreadPoolExecutor(1) as pool:
            future = pool.submit(self.worker_call)
            try:
                self.assertTrue(saved.wait(5))
                self.assertEqual(self.snapshot(), before)
            finally: release.set()
            self.assertEqual(future.result(5).status_code, 200)
        self.assertEqual(self.snapshot()['tag_score_revision'], before['tag_score_revision']+1)

    def test_source_change_or_image_replacement_invalidates_binding_without_rewriting_history(self):
        self.assertEqual(self.valid().status_code, 200)
        self.work.refresh_from_db(); self.work.tag_status = 'confirmed'; self.work.save()
        evidence = copy.deepcopy(self.work.tag_score_evidence)
        self.assertIsNotNone(current_evidence(self.work))
        self.assertEqual(self.put(self.work, description='바뀐 원문').status_code, 200)
        self.work.refresh_from_db(); self.work.tag_status = 'confirmed'; self.work.save()
        self.assertIsNone(current_evidence(self.work))
        self.assertEqual(self.work.tag_score_evidence, evidence)
        self.work.source_version = evidence['sourceVersion']
        self.work.image_file = 'other.png'
        self.assertIsNone(current_evidence(self.work))

    def test_untrusted_edit_fields_cannot_write_scores_evidence_or_revision(self):
        before = self.snapshot()
        response = self.put(self.work, tagScores={'warm': 1}, tagScoreEvidence=packet()['tagEvidence'], tagScoreRevision=999)
        self.assertEqual(response.status_code, 200, response.content)
        after = self.snapshot()
        for field in ('tag_scores', 'tag_score_evidence', 'tag_score_revision'):
            self.assertEqual(after[field], before[field])

    def test_model_validation_rejects_malformed_binding_and_missing_scores(self):
        self.assertEqual(self.valid().status_code, 200)
        self.work.refresh_from_db()
        for field, value in [('tag_scores', None), ('tag_scores', {'warm': .5}), ('tag_score_revision', 0), ('tag_score_evidence', {'bad': 1})]:
            old = getattr(self.work, field); setattr(self.work, field, value)
            with self.subTest(field=field), self.assertRaises(ValidationError): self.work.full_clean()
            setattr(self.work, field, old)

    def test_lock_wait_is_bounded_retryable_and_does_not_change_bundle(self):
        before = self.snapshot(); entered = threading.Event(); release = threading.Event()
        def hold():
            close_old_connections()
            try:
                with transaction.atomic():
                    Artwork.objects.select_for_update().get(pk=self.work.id)
                    entered.set(); self.assertTrue(release.wait(8))
            finally: close_old_connections()
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(hold)
            try:
                self.assertTrue(entered.wait(5))
                response = self.valid()
                self.assertEqual(response.status_code, 503, response.content)
                self.assertEqual(response.json()['code'], 'TEMPORARY_UNAVAILABLE')
                self.assertTrue(response.json()['retryable'])
                self.assertEqual(self.snapshot(), before)
            finally: release.set()
            future.result(5)
        # SET LOCAL은 transaction 밖에 남지 않고 advisory slot도 복구됩니다.
        with connection.cursor() as cursor:
            cursor.execute('SHOW lock_timeout'); self.assertEqual(cursor.fetchone()[0], '0')
        self.assertEqual(self.valid().status_code, 200)

    def test_budget_expiry_after_database_save_still_rolls_back(self):
        before = self.snapshot(); clock = [0]; original = editing.finish
        def expire(work, old):
            original(work, old); clock[0] = 61
        def generate(kind, *args, **kwargs):
            if kind == 'tag': return {'scores': packet()['tags'], 'tagEvidence': packet()['tagEvidence']}
            raise ContractError(503, 'AI_UNAVAILABLE', 'synthetic')
        with patch('arti.budget.monotonic', side_effect=lambda: clock[0]), patch('arti.editing.finish', side_effect=expire), patch('arti.providers.generate', side_effect=generate):
            response = self.call()
        self.assertEqual(response.status_code, 504, response.content)
        self.assertEqual(self.snapshot(), before)


class TagEvidenceMigrationTests(TransactionTestCase):
    def test_additive_migration_preserves_legacy_rows_and_empty_database(self):
        before_target = [('arti', '0002_independent_taste_survey')]
        after_target = [('arti', '0003_tag_score_evidence')]
        executor = MigrationExecutor(connection)
        try:
            executor.migrate(before_target)
            apps = executor.loader.project_state(before_target).apps
            ex = apps.get_model('arti', 'Exhibition').objects.create(id='legacy-ex', title='기존 전시',
                    start_date='2026-11-01', end_date='2026-11-30', status='draft')
            apps.get_model('arti', 'Artwork').objects.create(id='legacy-art', exhibition=ex, title='기존 작품',
                    artist='가상', tags=['warm'], tag_scores={'warm': .8}, tag_status='confirmed', review_status='approved')
            for pool_id, active in [('legacy-active', True), ('legacy-draft', False)]:
                pool = apps.get_model('arti', 'SurveyPool').objects.create(id=pool_id, name='기존 풀', revision=4, active=active)
                apps.get_model('arti', 'SurveyEntry').objects.create(pool=pool, artwork_id='legacy-art', position=0)
            account = apps.get_model('arti', 'Account').objects.create(id='legacy-user', login_id='legacy',
                    role='user', password='synthetic', taste_profile={'version': 1, 'selectedTags': ['warm']})
            apps.get_model('arti', 'Visit').objects.create(user=account, exhibition=ex,
                    visit_id='00000000-0000-4000-8000-000000000001', canonical_payload={'version': 1})
            models = ('Exhibition', 'Artwork', 'Account', 'Visit', 'SurveyPool', 'SurveyEntry')
            before = {m: list(apps.get_model('arti', m).objects.order_by('pk').values()) for m in models}
            executor = MigrationExecutor(connection); executor.migrate(after_target)
            apps = executor.loader.project_state(after_target).apps
            for m in models:
                rows = list(apps.get_model('arti', m).objects.order_by('pk').values())
                if m == 'Artwork':
                    for row in rows:
                        self.assertIsNone(row.pop('tag_score_evidence'))
                        self.assertEqual(row.pop('tag_score_revision'), 0)
                self.assertEqual(rows, before[m], m)
            # 이 역이관은 폐기 가능한 시험 DB에서만 수행합니다. 일반 DB 롤백 지침이 아닙니다.
            MigrationExecutor(connection).migrate([('arti', None)])
            executor = MigrationExecutor(connection); executor.migrate(after_target)
            apps = executor.loader.project_state(after_target).apps
            self.assertEqual(apps.get_model('arti', 'Artwork').objects.count(), 0)
            self.assertEqual(apps.get_model('arti', 'SurveyPool').objects.count(), 0)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
