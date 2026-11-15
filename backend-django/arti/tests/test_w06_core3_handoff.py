"""Trace synthetic W06 intake through the public catalog and docent entry."""

import importlib.util
import json
from hashlib import sha256
from pathlib import Path
from unittest import SkipTest
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from arti.models import Artwork, Exhibition


ROOT = Path(__file__).resolve().parents[3]
LAYOUT = ROOT / 'docs/execution-plan/2026-11-07/records/W06/readiness/layout-draft.json'
RECEIPT_CHECK = ROOT / 'scripts/yoo_core3_receipt.py'
WORDING_SHA = sha256(b'w06 rehearsal synthetic wording/current').hexdigest()


@override_settings(ARTI_ENV='test', ARTI_LLM_PROVIDER='disabled', ARTI_MODEL_SERVICE_URL='')
class W06Core3HandoffTests(TestCase):
    @classmethod
    def setUpClass(cls):
        if not RECEIPT_CHECK.is_file() or not LAYOUT.is_file():
            raise SkipTest('W06 receipt and layout checks require a repository checkout')
        spec = importlib.util.spec_from_file_location('yoo_core3_receipt', RECEIPT_CHECK)
        cls.precheck = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.precheck)
        if not cls.precheck.MANIFEST.is_file():
            raise SkipTest('W06 intake manifest requires a repository checkout')
        super().setUpClass()

    @classmethod
    def setUpTestData(cls):
        cls.manifest = json.loads(cls.precheck.MANIFEST.read_text(encoding='utf-8'))
        cls.layout = json.loads(LAYOUT.read_text(encoding='utf-8'))
        cls.draft_placements = {row['id']: row for row in cls.layout['items']}
        cls.image_hashes = {
            row['recordId']: sha256(f"w06 synthetic image {row['recordId']}".encode()).hexdigest()
            for row in cls.manifest['items']
        }
        cls.exhibition = Exhibition.objects.create(
            id='fixture-w06-handoff', title='합성 인수 전시', start_date='2026-01-01', end_date='2026-12-31',
            status='running', entrance_x=cls.layout['entrance']['x'], entrance_y=cls.layout['entrance']['y'],
            rooms=[{'id': zone['id'], 'name': f"합성 전시실 {zone['id']}"} for zone in cls.layout['zones']],
        )

    def setUp(self):
        self.api = APIClient(HTTP_HOST='localhost')

    def stage_synthetic_works(self, cases):
        self.assertEqual(self.manifest['exhibition']['id'], self.layout['exhibitionId'])
        staged = {}
        for item in self.manifest['items']:
            placement = self.draft_placements[item['id']]
            self.assertEqual((placement['recordId'], placement['assetId']), (item['recordId'], item['assetId']))
            record_id = item['recordId']
            number = record_id.rsplit('-', 1)[-1]
            scenario = cases.get(number, 'approve')
            wording = {field: f'합성 {field} {number}' for field in self.precheck.FIELDS}
            editorial = {'reviewer': '합성 독립 검수자', 'reviewedOn': '2026-11-16',
                         'decision': 'confirmed', 'evidence': '합성 문안 근거'}
            usage = {'reviewer': '합성 매체 검수자', 'reviewedOn': '2026-11-16', 'decision': 'confirmed',
                     'evidence': '합성 권리 근거', 'scope': '합성 시연 범위'}
            receipt = {
                'recordId': record_id, 'imageSha256': self.image_hashes[record_id],
                'wordingSha256': '0' * 64 if scenario == 'old-wording' else WORDING_SHA,
                'content': [dict(editorial, field=field, judgedText=text) for field, text in wording.items()],
                'usage': [dict(usage, medium='presentation' if scenario == 'missing-medium' else 'campus_demo')],
            }
            # Only this test fixture records an explicit simulated approval after precheck.
            approved = scenario == 'approve'
            handoff = self.precheck.check_receipt(receipt, self.image_hashes, WORDING_SHA)['handoff']
            self.assertEqual(handoff['media']['campus_demo']['status'], 'ready-for-review' if approved else 'pending')
            if scenario == 'missing-medium':
                self.assertEqual(handoff['media']['presentation']['status'], 'ready-for-review')
            if scenario == 'old-wording':
                self.assertTrue(handoff['media']['campus_demo']['usageConfirmed'])
                self.assertEqual(handoff['pendingContentFields'], list(self.precheck.FIELDS))
            revision_seed = int(number)
            work = Artwork.objects.create(
                id=f'fixture-w06-{number}', exhibition=self.exhibition, title=f'합성 작품 {number}', artist='합성 작가',
                room_id=placement['zoneId'], position_x=placement['x'], position_y=placement['y'], show_image=False,
                description=wording['description'], summary=wording['summary'],
                guided_looking=[wording['question']], guided_hints=[wording['hint']],
                review_status='approved' if approved else 'source_check',
                summary_status='confirmed' if approved else 'suggested', guide_status='confirmed' if approved else 'suggested',
                source_version=revision_seed + 1, content_version=revision_seed + 4, guide_revision=revision_seed + 3,
            )
            staged[number] = (work, placement, wording)
        return staged

    def assert_recommendation_and_map(self, ids):
        response = self.api.post('/api/recommendations', {
            'exhibitionId': self.exhibition.id, 'duration': '30m', 'tastes': [],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([(r['order'], r['artworkId']) for r in response.json()], list(enumerate(ids, start=1)))
        map_response = self.api.get('/api/artworks', {'exhibitionId': self.exhibition.id})
        self.assertEqual(map_response.status_code, 200, map_response.content)
        markers = {row['id']: row for row in map_response.json()}
        self.assertCountEqual(markers, ids)
        return markers

    def ask(self, work, content_version):
        return self.api.post(f'/api/artworks/{work.id}/ask', {
            'question': '이 지점을 어떻게 살펴볼까요?',
            'entryContext': {'tab': 'guided', 'kind': 'guide', 'questionIndex': 0, 'contentVersion': content_version},
        }, format='json', REMOTE_ADDR='192.0.2.16')

    @patch('arti.docent.providers.generate', return_value={'answer': '합성 답변'})
    def test_approved_path_replays_recommendation_map_detail_and_question_ids(self, provider):
        staged = self.stage_synthetic_works({})
        # With no taste tags, the two 30-unit moves from 004 tie and the lower ID wins.
        ordered = [staged[number] for number in ('004', '001', '010')]
        for iteration in (1, 2):
            markers = self.assert_recommendation_and_map([work.id for work, _, _ in ordered])
            for work, position, wording in ordered:
                with self.subTest(iteration=iteration, work=work.id):
                    marker = markers[work.id]
                    self.assertEqual(marker['roomId'], position['zoneId'])
                    self.assertEqual(marker['position'], {'x': position['x'], 'y': position['y']})
                    detail = self.api.get(f"/api/artworks/{marker['id']}")
                    self.assertEqual(detail.status_code, 200, detail.content)
                    data = detail.json()
                    self.assertEqual(data['id'], marker['id'])
                    self.assertEqual(data['description'], wording['description'])
                    self.assertEqual(data['summary'], wording['summary'])
                    self.assertEqual(data['guidedLooking'], [wording['question']])
                    self.assertEqual(data['guidedHints'], [wording['hint']])
                    self.assertEqual((data['sourceVersion'], data['guideRevision']),
                                     (work.source_version, work.guide_revision))
                    answer = self.ask(work, data['contentVersion'])
                    self.assertEqual(answer.status_code, 200, answer.content)
                    self.assertEqual(answer.json()['sourceRefs'], [{
                        'artworkId': data['id'], 'sourceVersion': data['sourceVersion'],
                        'kind': 'guide', 'revision': data['guideRevision'],
                    }])
                    self.assertEqual(provider.call_args.args[1]['id'], data['id'])
                    self.assertEqual(provider.call_args.kwargs['entry']['question'], wording['question'])
        self.assertEqual(provider.call_count, 6)

    @patch('arti.docent.providers.generate')
    def test_missing_medium_or_old_wording_excludes_work_and_stale_question(self, provider):
        staged = self.stage_synthetic_works({'004': 'missing-medium', '010': 'old-wording'})
        active = staged['001'][0]
        for _ in range(2):
            self.assert_recommendation_and_map([active.id])
        for number in ('004', '010'):
            work = staged[number][0]
            self.assertEqual(self.api.get(f'/api/artworks/{work.id}').status_code, 404)
            self.assertEqual(self.ask(work, work.content_version).status_code, 404)
        stale = self.ask(active, active.content_version - 1)
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(stale.json()['code'], 'CONTENT_CHANGED')
        provider.assert_not_called()
