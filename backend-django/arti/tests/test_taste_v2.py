# 기존 30개 동점 반례와 PostgreSQL API의 저장·관람 경계를 검증합니다.
import importlib.util
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps
from django.conf import settings
from django.db import close_old_connections, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from arti import taste_resolution as resolution
from arti.constants import TAGS
from arti.http import ContractError
from arti.model_service import evidence_digest
from arti.models import Account, Artwork, Exhibition, SurveyPool, Visit
from arti.tests.test_integration import Helpers
from arti.tests.test_tag_evidence import packet


@override_settings(ARTI_TASTE_PROFILE_V2_ENABLED=True)
class ParityTests(SimpleTestCase):
    def test_contract_cases(self):
        root = Path(__file__).resolve().parents[3]
        spec = importlib.util.spec_from_file_location('oracle', root/'scripts/taste_tie_contract.py')
        oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(oracle)
        records = json.loads((oracle.RECORD/'cases.json').read_text(encoding='utf-8'))
        for case in records['cases']:
            with self.subTest(case=case['id']):
                request = oracle.case_request(records, case)
                expected = case['expected']
                profile = {'source': request['mode'], 'selectedTags': request['selectedTags'],
                           'picks': request.get('picks'), 'poolVersion': request.get('poolVersion'),
                           'tieContextVersion': request['evidenceVersion'],
                           'savedProfileVersion': request.get('savedProfileVersion')}
                if profile['source'] != 'picks':
                    profile.pop('tieContextVersion')
                rows = request['poolRows']
                approved = request.get('approvedSignature')
                normalized = []
                for row in rows:
                    scores = row.get('scores')
                    normalized.append({
                        **row, 'signature': evidence_digest(row['signature']) if row.get('signature') else None,
                        'scoresUnits': {tag: resolution.score_units(scores.get(tag) if isinstance(scores, dict) else None)
                                        for tag in TAGS},
                        'scoreRevision': row.get('scoreRevision'), 'imageSha256': row.get('imageSha256'),
                    })
                works = [SimpleNamespace(id=row['id'], tags=row['tags']) for row in rows]
                if not request['ready'] or any(row.get('tagStatus') != 'confirmed' for row in rows):
                    works = []
                pool = (SimpleNamespace(id='synthetic', revision=1), works, request['currentPoolVersion'])
                context = (normalized, evidence_digest(approved) if approved else None,
                           oracle.evidence_version(rows, approved, request['currentPoolVersion']))
                account = None
                if request.get('authenticated'):
                    account = SimpleNamespace(role='user', tastes=request['accountTags'],
                                              taste_profile=request.get('serverSnapshot'),
                                              taste_profile_version=request['accountProfileVersion'])
                with patch.object(resolution, 'current_pool', return_value=pool) as pool_read, patch.object(
                        resolution, 'pool_context', return_value=context):
                    if 'error' in expected:
                        with self.assertRaises(ContractError) as raised:
                            resolution.resolve(profile, request['selectedTags'], account)
                        self.assertEqual(raised.exception.contract_code, expected['error'])
                    else:
                        _, counts, groups = resolution.resolve(profile, request['selectedTags'], account)
                        reference = oracle.resolve(request)
                        self.assertEqual(counts, reference['counts'])
                        self.assertEqual(groups, reference['groups'])
                        self.assertEqual([tag for group in groups for tag in group['tags']], expected['tagOrder'])
                    if profile['source'] != 'picks':
                        pool_read.assert_not_called()


@override_settings(ARTI_TASTE_PROFILE_V2_ENABLED=True, ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class TasteV2Tests(Helpers, TransactionTestCase):
    def setUp(self):
        self.setup_clients()
        self.url = '/api/users/'+self.actors[0].id+'/tastes'
        self.resolve_url = '/api/taste-profiles/resolve'

    def profile(self):
        data = self.public.get('/api/taste-pool').json()
        self.assertTrue(data['ready'])
        return {'version': 2, 'source': 'picks', 'poolVersion': data['poolVersion'],
                'tieContextVersion': data['tieContext']['tieContextVersion'], 'selectedTags': ['landscape'],
                'picks': [{'pairIndex': index, 'artworkId': pair['leftId']} for index, pair in enumerate(data['pairs'])]}

    def body(self, profile=None, version=1):
        profile = profile or self.profile()
        return {'tasteProfile': profile, 'tastes': profile['selectedTags'], 'expectedSavedProfileVersion': version,
                'clientMutationId': str(uuid.uuid4()), 'exhibitionId': 'fixture-ex01'}

    def account(self):
        return Account.objects.get(pk=self.actors[0].pk)

    def test_preview_read_only_and_server_counts(self):
        profile = self.profile()
        profile['counts'] = {'landscape': 0}
        def state():
            return [list(model.objects.order_by('pk').values()) for model in apps.get_app_config('arti').get_models()]
        def media():
            return {path.name: path.read_bytes() for path in settings.MEDIA_ROOT.iterdir()}
        before, files = state(), media()
        with CaptureQueriesContext(connection) as sql, patch('arti.providers.generate') as provider:
            response = self.a.post(self.resolve_url, {'tasteProfile': profile, 'visitId': str(uuid.uuid4())}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()['userConfirmed'])
        self.assertGreater(response.json()['tasteProfile']['counts']['landscape'], 0)
        self.assertIn('visitEvidenceReceipt', response.json())
        self.assertFalse(any(query['sql'].lstrip().split()[0].upper() in ('INSERT', 'UPDATE', 'DELETE') for query in sql))
        provider.assert_not_called()
        self.assertEqual((state(), media()), (before, files))

    def test_approved_scores_drive_ties_and_unselected_revision_invalidates_preview(self):
        Artwork.objects.filter(pk__in=[f'fixture-art{i:02}' for i in range(1, 11)]).update(tags=['landscape', 'warm'])
        value = packet()
        scores = {tag: .4 for tag in TAGS}
        scores['warm'] = .9
        proof = dict(value['tagEvidence'])
        proof['scoresSha256'] = evidence_digest(scores)
        proof.pop('evidenceSha256')
        proof['evidenceSha256'] = evidence_digest(proof)
        for work in Artwork.objects.filter(pk__in=[f'fixture-art{i:02}' for i in range(1, 11)]):
            work.tag_scores, work.tag_score_revision = scores, 1
            work.tag_score_evidence = proof | {'sourceVersion': work.source_version, 'inputImageFile': work.image_file}
            work.save(update_fields=['tag_scores', 'tag_score_revision', 'tag_score_evidence'])
        with override_settings(ARTI_TASTE_APPROVED_SIGNATURE_SHA256=proof['signatureSha256']):
            profile = self.profile() | {'selectedTags': ['landscape', 'warm']}
            response = self.public.post(self.resolve_url, {'tasteProfile': profile}, format='json')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['tagOrder'], ['warm', 'landscape'])
            self.assertEqual(response.json()['groups'][0]['rule'], 'ai_secondary')
            self.assertNotIn('scoreTotalsUnits', response.json()['groups'][0])
            Artwork.objects.filter(pk='fixture-art02').update(tag_score_revision=2)
            self.assertEqual(self.public.post(self.resolve_url, {'tasteProfile': profile}, format='json').status_code, 409)
        with override_settings(ARTI_TASTE_APPROVED_SIGNATURE_SHA256=''):
            profile = self.profile() | {'selectedTags': ['landscape', 'warm']}
            self.assertEqual(self.public.post(self.resolve_url, {'tasteProfile': profile}, format='json').json()['tagOrder'],
                             ['landscape', 'warm'])

    def test_retry_precedes_pool_and_feature_checks(self):
        body = self.body()
        self.assertEqual(self.a.put(self.url, body, format='json').status_code, 204)
        saved = self.account()
        SurveyPool.objects.update(active=False)
        with override_settings(ARTI_TASTE_PROFILE_V2_ENABLED=False):
            capability = self.public.get('/api/taste-pool').json()
            self.assertEqual(capability['supportedTasteProfileVersions'], [1, 2])
            self.assertFalse(capability['tasteTieV2Enabled'])
            with CaptureQueriesContext(connection) as sql:
                self.assertEqual(self.a.put(self.url, body, format='json').status_code, 204)
            self.assertFalse(any(query['sql'].lstrip().upper().startswith('UPDATE') for query in sql))
            self.assertEqual(self.a.put(self.url, body | {'exhibitionId': None}, format='json').status_code, 409)
            self.assertEqual(self.a.put(self.url, body | {'clientMutationId': str(uuid.uuid4()),
                                                         'expectedSavedProfileVersion': 2}, format='json').status_code, 503)
            self.assertEqual(self.a.post(self.resolve_url, {'tasteProfile': body['tasteProfile']}, format='json').status_code, 503)
            self.assertEqual(self.a.post('/api/recommendations', {'tasteProfile': body['tasteProfile'],
                                  'tastes': body['tastes'], 'exhibitionId': 'fixture-ex01',
                                  'duration': '30m'}, format='json').status_code, 503)
        self.assertEqual(self.account().taste_profile_version, 2)
        self.assertEqual(self.account().taste_write_receipt, saved.taste_write_receipt)

    def test_recommendations_reuse_preview_order_only_for_coverage(self):
        tags = ['landscape', 'people', 'light', 'warm']
        works = Artwork.objects.filter(pk__in=[f'fixture-art{i:02}' for i in range(1, 11)]).order_by('id')
        for index, work in enumerate(works):
            scores = dict.fromkeys(TAGS, 0)
            if index < 4:
                scores[tags[index]] = .6
            else:
                scores['warm'] = .49
            proof = dict(packet()['tagEvidence'])
            proof['scoresSha256'] = evidence_digest({tag: float(value) for tag, value in scores.items()})
            proof.pop('evidenceSha256')
            proof['evidenceSha256'] = evidence_digest(proof)
            work.tags, work.tag_scores, work.tag_score_revision = tags, scores, 1
            work.tag_score_evidence = proof | {'sourceVersion': work.source_version, 'inputImageFile': work.image_file}
            work.save(update_fields=['tags', 'tag_scores', 'tag_score_revision', 'tag_score_evidence'])
        with override_settings(ARTI_TASTE_APPROVED_SIGNATURE_SHA256=proof['signatureSha256']):
            profile = self.profile() | {'selectedTags': tags}
            preview = self.public.post(self.resolve_url, {'tasteProfile': profile}, format='json')
            self.assertEqual(preview.status_code, 200, preview.content)
            self.assertEqual(preview.json()['tagOrder'][0], 'warm')
            request = {'tasteProfile': profile, 'tastes': tags, 'exhibitionId': 'fixture-ex01', 'duration': '30m'}
            current = self.public.post('/api/recommendations', request, format='json')
            legacy = self.public.post('/api/recommendations', request | {'tasteProfile': profile | {'version': 1}}, format='json')
            self.assertEqual((current.status_code, legacy.status_code), (200, 200))
            current_scores, legacy_scores = [{row['artworkId']: row['score'] for row in response.json()}
                                             for response in (current, legacy)]
            self.assertIn('fixture-art04', current_scores)
            self.assertNotIn('fixture-art04', legacy_scores)
            self.assertEqual(len(current_scores), len(legacy_scores))
            for artwork_id in current_scores.keys() & legacy_scores.keys():
                self.assertEqual(current_scores[artwork_id], legacy_scores[artwork_id])
            self.assertFalse(Artwork.objects.filter(pk__in=current_scores).exclude(exhibition_id='fixture-ex01').exists())

    def test_legacy_guard_noop_and_frozen_saved_order(self):
        body = self.body()
        self.assertEqual(self.a.put(self.url, body, format='json').status_code, 204)
        second = body | {'clientMutationId': str(uuid.uuid4()), 'expectedSavedProfileVersion': 2}
        self.assertEqual(self.a.put(self.url, second, format='json').status_code, 204)
        self.assertEqual(self.account().taste_profile_version, 2)
        self.assertEqual(self.a.put(self.url, body, format='json').status_code, 409)
        self.assertEqual(self.a.put(self.url, {'tastes': ['warm']}, format='json').status_code, 409)
        SurveyPool.objects.update(active=False)
        profile = {'version': 2, 'source': 'saved', 'savedProfileVersion': 2, 'selectedTags': body['tastes']}
        with override_settings(ARTI_TASTE_PROFILE_V2_ENABLED=False):
            response = self.a.post('/api/recommendations', {'tasteProfile': profile, 'tastes': body['tastes'],
                                  'exhibitionId': 'fixture-ex01', 'duration': '30m'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()), 3)
        self.assertEqual(self.account().taste_profile_version, 2)

    def test_visit_proof_survives_pool_change_but_rejects_wrong_context(self):
        profile = self.profile()
        visit = self.payload() | {'tasteProfile': profile, 'tastes': profile['selectedTags']}
        issued = 1_800_000_000
        with patch('django.core.signing.time.time', return_value=issued):
            response = self.a.post(self.resolve_url, {'tasteProfile': profile, 'visitId': visit['visitId'],
                                   'exhibitionId': visit['exhibitionId']}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        receipt = response.json()['visitEvidenceReceipt']
        visit['tasteEvidenceReceipt'] = receipt
        self.assertEqual(self.b.post('/api/visits', visit, format='json').status_code, 400)
        self.assertEqual(self.public.post('/api/visits', visit, format='json').status_code, 400)
        self.assertEqual(self.a.post('/api/visits', visit | {'visitId': str(uuid.uuid4())}, format='json').status_code, 400)
        self.assertEqual(self.a.post('/api/visits', visit | {'tasteEvidenceReceipt': receipt+'x'}, format='json').status_code, 400)
        self.assertEqual(self.a.post('/api/visits', visit | {'tastes': ['warm']}, format='json').status_code, 400)
        self.assertFalse(Visit.objects.exists())
        with patch('django.core.signing.time.time', return_value=issued+72*3600+1):
            self.assertEqual(self.a.post('/api/visits', visit, format='json').status_code, 409)
        SurveyPool.objects.update(active=False)
        self.assertEqual(self.a.put(self.url, self.body(profile), format='json').status_code, 409)
        with override_settings(ARTI_TASTE_PROFILE_V2_ENABLED=False):
            with patch('django.core.signing.time.time', return_value=issued+72*3600):
                stored = self.a.post('/api/visits', visit, format='json')
            self.assertEqual(stored.status_code, 201, stored.content)
            self.assertNotIn('tasteEvidenceReceiptHash', stored.json())
            self.assertEqual(stored.json()['tasteProfile']['counts'], response.json()['tasteProfile']['counts'])
            with patch('django.core.signing.time.time', return_value=issued+72*3600+1):
                self.assertEqual(self.a.post('/api/visits', visit, format='json').status_code, 200)
                self.assertEqual(self.a.post('/api/visits', visit | {'tasteEvidenceReceipt': receipt+'x'}, format='json').status_code, 409)
        self.assertEqual(self.account().taste_profile_version, 1)
        self.assertEqual(Visit.objects.count(), 1)

    def test_auth_and_forged_payload(self):
        profile = self.profile()
        saved = {'version': 2, 'source': 'saved', 'savedProfileVersion': 1, 'selectedTags': ['warm']}
        self.assertEqual(self.public.post(self.resolve_url, {'tasteProfile': saved}, format='json').status_code, 401)
        self.assertEqual(self.admin.post(self.resolve_url, {'tasteProfile': saved}, format='json').status_code, 401)
        self.assertEqual(self.b.put(self.url, self.body(profile), format='json').status_code, 403)
        for forged in ({'tieEvidence': {}}, {'tagOrder': ['warm']}, {'version': '2.0'}):
            self.assertEqual(self.a.post(self.resolve_url, {'tasteProfile': profile | forged}, format='json').status_code, 400)
        self.assertEqual(self.a.put(self.url, self.body(profile) | {'expectedSavedProfileVersion': True}, format='json').status_code, 400)
        self.assertEqual(self.account().taste_profile_version, 1)

    def run_parallel(self, requests):
        barrier = threading.Barrier(len(requests))
        def call(method, path, body, header):
            close_old_connections()
            try:
                client = APIClient(HTTP_HOST='localhost')
                barrier.wait(5)
                return getattr(client, method)(path, body, format='json', **header).status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(len(requests)) as pool:
            futures = [pool.submit(call, *request) for request in requests]
            return sorted(future.result(10) for future in futures)

    def test_real_postgres_cas_and_reverse_batch(self):
        auth = {'HTTP_AUTHORIZATION': 'Bearer synthetic-token-a'}
        body = self.body()
        manual = {'version': 2, 'source': 'manual', 'selectedTags': ['warm']}
        self.assertEqual(self.run_parallel([('put', self.url, body, auth), ('put', self.url, self.body(manual), auth)]), [204, 409])
        self.assertEqual(self.account().taste_profile_version, 2)
        items = [{'id': work.id, 'version': work.version, 'fields': ['tag']}
                 for work in Artwork.objects.filter(pk__in=['fixture-art01', 'fixture-art02'])]
        url = '/api/admin/exhibitions/fixture-ex01/confirm-ai'
        admin = {'HTTP_X_ADMIN_TOKEN': 'synthetic-token-admin'}
        self.assertEqual(self.run_parallel([('post', url, {'items': items}, admin),
                                            ('post', url, {'items': items[::-1]}, admin)]), [200, 409])

    def test_pool_switch_and_score_change_during_preview(self):
        for change in ('pool', 'score'):
            profile = self.profile()
            lock_requested = threading.Event()
            backend_pid = []
            real_pool = resolution.current_pool
            def intercept(*, lock=False):
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_backend_pid()')
                    backend_pid.append(cursor.fetchone()[0])
                lock_requested.set()
                return real_pool(lock=lock)
            def preview():
                close_old_connections()
                try:
                    client = APIClient(HTTP_HOST='localhost')
                    return client.post(self.resolve_url, {'tasteProfile': profile}, format='json')
                finally:
                    close_old_connections()
            with patch.object(resolution, 'current_pool', side_effect=intercept), ThreadPoolExecutor(1) as pool:
                with transaction.atomic():
                    if change == 'pool':
                        old = SurveyPool.objects.select_for_update().get(active=True)
                        replacement = SurveyPool.objects.create(id='replacement', name='replacement')
                        from arti.models import SurveyEntry
                        SurveyEntry.objects.bulk_create([SurveyEntry(pool=replacement, artwork_id=e.artwork_id, position=e.position)
                                                         for e in old.entries.all()])
                        old.active = False
                        old.save(update_fields=['active'])
                        replacement.active = True
                        replacement.save(update_fields=['active'])
                    else:
                        Artwork.objects.filter(pk='fixture-art02').update(tag_score_revision=8)
                    future = pool.submit(preview)
                    self.assertTrue(lock_requested.wait(5))
                    deadline = time.monotonic()+1
                    blocked = False
                    while time.monotonic() < deadline and not blocked:
                        with connection.cursor() as cursor:
                            cursor.execute('SELECT cardinality(pg_blocking_pids(%s)) > 0', [backend_pid[0]])
                            blocked = cursor.fetchone()[0]
                        if not blocked:
                            time.sleep(.01)
                    self.assertTrue(blocked)
                response = future.result(8)
            # 첫 SELECT 시작 당시 새 풀 행이 보이지 않았다면 409로 재조회하게 합니다.
            self.assertEqual(response.status_code, 409, response.content)
            response = self.public.post(self.resolve_url, {'tasteProfile': self.profile()}, format='json')
            self.assertEqual(response.status_code, 200, response.content)

    def test_preview_lock_timeout_is_retryable(self):
        profile = self.profile()

        def request_preview():
            close_old_connections()
            try:
                return APIClient(HTTP_HOST='localhost').post(self.resolve_url, {'tasteProfile': profile}, format='json')
            finally:
                close_old_connections()

        with ThreadPoolExecutor(1) as workers, transaction.atomic():
            SurveyPool.objects.select_for_update().get(active=True)
            response = workers.submit(request_preview).result(8)
            self.assertEqual(response.status_code, 503, response.content)
            self.assertEqual(response.json()['code'], 'TEMPORARY_UNAVAILABLE')
            self.assertTrue(response.json()['retryable'])
        self.assertEqual(self.public.post(self.resolve_url, {'tasteProfile': profile}, format='json').status_code, 200)


class TasteReceiptMigrationTests(TransactionTestCase):
    def test_existing_profile_preserved(self):
        before, after = [('arti', '0003_tag_score_evidence')], [('arti', '0004_taste_write_receipt')]
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            old = executor.loader.project_state(before).apps.get_model('arti', 'Account')
            profile = {'version': 1, 'counts': {'warm': 2}, 'selectedTags': ['warm']}
            old.objects.create(id='legacy-tp2', login_id='legacy-tp2', role='user', password='fixture',
                               tastes=['warm'], taste_profile=profile, taste_profile_version=4)
            MigrationExecutor(connection).migrate(after)
            account = Account.objects.get(pk='legacy-tp2')
            self.assertEqual((account.tastes, account.taste_profile, account.taste_profile_version, account.taste_write_receipt),
                             (['warm'], profile, 4, None))
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
