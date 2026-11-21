from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from django.db import connections
from django.test import TestCase, TransactionTestCase, override_settings

from arti.editing import get_locked
from arti.models import Artwork, DocentTranscript, Exhibition, OperationEvent, SurveyEntry, SurveyPool, Visit
from arti.receipt_evidence import issue_artwork_evidence
from arti.records import canonical
from arti.serializers import artwork_dto
from arti.tests.test_integration import Helpers


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class CatalogDeletionTests(Helpers, TestCase):
    def setUp(self):
        self.setup_clients()
        self.exhibition = Exhibition.objects.create(
            title='삭제 검증 전시', start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.work = Artwork.objects.create(exhibition=self.exhibition, title='삭제 검증 작품', artist='합성 작가')
        self.exhibition_path = f'/api/admin/exhibitions/{self.exhibition.id}'
        self.work_path = f'/api/admin/artworks/{self.work.id}'

    def delete(self, path, version=1):
        return self.admin.delete(path, HTTP_IF_MATCH=f'"{version}"')

    def assert_blocked(self, path, message):
        response = self.delete(path)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['code'], 'DELETE_BLOCKED')
        self.assertIn(message, response.json()['error'])

    def test_unused_records_require_admin_and_the_current_version(self):
        self.assertEqual(self.public.delete(self.work_path).status_code, 401)
        self.assertEqual(self.a.delete(self.exhibition_path, HTTP_X_ADMIN_TOKEN='synthetic-token-a').status_code, 401)
        self.assertEqual(self.delete('/api/admin/artworks').status_code, 405)
        self.assertEqual(self.delete('/api/admin/exhibitions').status_code, 405)
        self.assertEqual(self.admin.delete(self.work_path).status_code, 400)
        self.assertEqual(self.delete(self.work_path, version=2).status_code, 409)
        self.assert_blocked(self.exhibition_path, '연결된 작품')
        self.assertEqual(self.delete(self.work_path).status_code, 204)
        self.assertEqual(self.delete(self.exhibition_path).status_code, 204)
        self.assertEqual(self.admin.get(self.work_path).status_code, 404)
        self.assertEqual(self.admin.get(self.exhibition_path).status_code, 404)
        self.assertTrue(OperationEvent.objects.filter(action='artwork_delete', status=204).exists())
        self.assertTrue(OperationEvent.objects.filter(action='exhibition_delete', status=204).exists())

    def test_an_active_exhibition_and_approved_artwork_cannot_be_deleted(self):
        Exhibition.objects.filter(pk=self.exhibition.pk).update(status='running')
        Artwork.objects.filter(pk=self.work.pk).update(review_status='approved')
        self.assert_blocked(self.exhibition_path, '운영 중인 전시')
        self.assert_blocked(self.work_path, '검수 완료된 작품')

    def test_links_to_direct_order_survey_and_docent_transcripts_are_protected(self):
        Exhibition.objects.filter(pk=self.exhibition.pk).update(direct_visit_order=[self.work.pk])
        self.assert_blocked(self.work_path, '전시 관람 순서')
        Exhibition.objects.filter(pk=self.exhibition.pk).update(direct_visit_order=[])
        pool = SurveyPool.objects.create(name='삭제 검증 조사')
        entry = SurveyEntry.objects.create(pool=pool, artwork=self.work, position=0)
        self.assert_blocked(self.work_path, '취향 조사')
        entry.delete()
        transcript = DocentTranscript.objects.create(
            account=self.actors[0], artwork=self.work, visit_id=uuid4(),
        )
        self.assert_blocked(self.work_path, '도슨트 대화')
        self.assertTrue(DocentTranscript.objects.filter(pk=transcript.pk).exists())

    def test_receipt_history_is_protected_even_without_reactions_or_current_exhibition(self):
        for fields in (
            {'canonical_payload': {'viewedArtworkIds': [self.work.pk]}},
            {'artwork_snapshots': [{'id': self.work.pk, 'title': self.work.title}]},
        ):
            with self.subTest(fields=fields):
                receipt = Visit.objects.create(
                    user=self.actors[0], exhibition_id='fixture-ex01', visit_id=uuid4(), **fields,
                )
                self.assert_blocked(self.work_path, '관람 기록')
                self.assertTrue(Visit.objects.filter(pk=receipt.pk).exists())
                receipt.delete()

        self.assertEqual(self.delete(self.work_path).status_code, 204)
        Exhibition.objects.filter(pk=self.exhibition.pk).update(status='closed')
        receipt = Visit.objects.create(user=self.actors[0], exhibition=self.exhibition, visit_id=uuid4())
        self.assert_blocked(self.exhibition_path, '전시를 종료 상태로 보관')
        self.assertTrue(Visit.objects.filter(pk=receipt.pk).exists())


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class ConcurrentCatalogDeletionTests(Helpers, TransactionTestCase):
    def test_artwork_deletion_waits_for_a_receipt_that_is_already_saving(self):
        self.setup_clients()
        ex = Exhibition.objects.get(pk='fixture-ex01')
        work = Artwork.objects.create(exhibition=ex, title='저장 동시성 검수 작품', artist='합성 작가', review_status='approved')
        payload = self.payload()
        exhibition = {'id': ex.pk, 'title': ex.title, 'venue': ex.venue}
        evidence = issue_artwork_evidence(self.actors[0], payload['visitId'], exhibition, artwork_dto(work))
        payload.update(viewedArtworkIds=[work.pk], artworkReceiptEvidence={work.pk: evidence},
                       reactions={}, reactionReasons={}, dwell={})
        Artwork.objects.filter(pk=work.pk).update(review_status='pending')
        receipt_validated = Event()
        finish_receipt = Event()
        delete_started = Event()

        def pause_after_validation(data, account):
            result = canonical(data, account)
            receipt_validated.set()
            if not finish_receipt.wait(5):
                raise RuntimeError('Timed out waiting to finish the synthetic receipt.')
            return result

        def save_receipt():
            try:
                return self.a.post('/api/visits', payload, format='json')
            finally:
                connections.close_all()

        def delete_work():
            try:
                return self.admin.delete(f'/api/admin/artworks/{work.pk}', HTTP_IF_MATCH=f'"{work.version}"')
            finally:
                connections.close_all()

        def report_lock_attempt(model, pk):
            if model is Exhibition:
                delete_started.set()
            return get_locked(model, pk)

        with (patch('arti.records.canonical', side_effect=pause_after_validation),
              patch('arti.editing.get_locked', side_effect=report_lock_attempt),
              ThreadPoolExecutor(2) as threads):
            saving = threads.submit(save_receipt)
            try:
                self.assertTrue(receipt_validated.wait(5))
                deleting = threads.submit(delete_work)
                self.assertTrue(delete_started.wait(5))
                with self.assertRaises(TimeoutError):
                    deleting.result(0.2)
            finally:
                finish_receipt.set()
            saved, blocked = saving.result(5), deleting.result(5)
        self.assertEqual(saved.status_code, 201, saved.content)
        self.assertEqual(blocked.status_code, 409, blocked.content)
        self.assertEqual(blocked.json()['code'], 'DELETE_BLOCKED')
        self.assertEqual(Visit.objects.get(visit_id=payload['visitId']).artwork_snapshots[0]['id'], work.pk)
