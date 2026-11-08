# 범용 전시 인수의 사전 검사·충돌 차단·실패 복구·공개 격리를 PostgreSQL에서 검증합니다.
import copy
import hashlib
import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from arti.models import Artwork, Exhibition
from arti.management.commands.load_test_fixture import PNG


class ExhibitionImportTests(TestCase):
    def setUp(self):
        bundle = tempfile.TemporaryDirectory(); media = tempfile.TemporaryDirectory()
        self.addCleanup(bundle.cleanup); self.addCleanup(media.cleanup)
        self.root = Path(bundle.name); self.media = Path(media.name)
        settings = override_settings(MEDIA_ROOT=self.media)
        settings.enable(); self.addCleanup(settings.disable)
        self.data = {'format': 'arti-exhibition-intake', 'version': 1,
            'exhibition': {'id': 'ex-intake-a', 'title': '합성 전시', 'subtitle': '시연용 재구성·미검수',
                'venue': '실제 장소 미정', 'startDate': '2026-11-09', 'endDate': '2026-12-31',
                'kind': 'demo_reconstruction', 'basis': '합성 인수 검증용'},
            'items': [{'id': 'intake-a1', 'recordId': 'record-a1', 'assetId': 'asset-a1', 'file': 'intake-a1.png',
                'sha256': hashlib.sha256(PNG).hexdigest(), 'title': '같은 제목', 'artist': '합성 작가', 'year': '2026',
                'description': '팀 작성 합성 관찰 초안', 'source': '합성 검증·사람 확인 대기',
                'referenceUrl': 'https://example.test/one', 'contentOrigin': 'team_draft', 'identityStatus': 'candidate',
                'rightsStatus': 'unverified', 'summary': '합성 요약 제안',
                'guide': {'intro': '색을 보세요', 'questions': ['어디가 보이나요?'], 'hints': ['경계를 보세요']}}]}
        (self.root / 'intake-a1.png').write_bytes(PNG)

    def run_import(self, dry=False):
        (self.root / 'manifest.json').write_text(json.dumps(self.data), encoding='utf-8')
        output = io.StringIO()
        call_command('import_exhibition_bundle', str(self.root), dry_run=dry, stdout=output)
        return json.loads(output.getvalue())

    def assert_empty(self):
        self.assertFalse(Exhibition.objects.exists()); self.assertFalse(Artwork.objects.exists())
        self.assertEqual(list(self.media.iterdir()), [])

    def test_dry_run_writes_nothing_then_import_stays_private(self):
        self.assertTrue(self.run_import(True)['dryRun']); self.assert_empty()
        self.assertEqual(self.run_import()['works'], 1)
        w = Artwork.objects.get(pk='intake-a1')
        self.assertEqual(w.exhibition.status, 'draft'); self.assertEqual(w.review_status, 'source_check')
        self.assertFalse(w.show_image); self.assertIsNone(w.position_x); self.assertEqual(w.tags, [])
        self.assertEqual((w.summary_status, w.guide_status), ('suggested', 'suggested'))
        client = APIClient(HTTP_HOST='localhost')
        self.assertEqual(client.get('/api/exhibitions').json(), [])
        for path in ['/api/exhibitions/ex-intake-a', '/api/artworks/intake-a1', '/api/uploads/intake-a1.png']:
            self.assertEqual(client.get(path).status_code, 404)
        self.assertEqual((self.media / w.image_file).read_bytes(), PNG)

    def test_reimport_and_media_collision_preserve_existing_data(self):
        self.run_import(); w = Artwork.objects.get(); w.summary = '검수자가 바꾼 내용'; w.save()
        with self.assertRaises(CommandError): self.run_import()
        self.assertEqual(Artwork.objects.get().summary, '검수자가 바꾼 내용')
        self.assertEqual((self.media / 'intake-a1.png').read_bytes(), PNG)

    def test_foreign_exhibition_remains_unchanged_and_titles_are_not_ids(self):
        self.run_import()
        self.data['exhibition']['id'] = 'ex-intake-b'
        row = self.data['items'][0]
        row.update(id='intake-b1', recordId='record-b1', assetId='asset-b1', file='intake-b1.png')
        (self.root / row['file']).write_bytes(PNG)
        self.run_import()
        self.assertEqual(Exhibition.objects.count(), 2)
        self.assertEqual(set(Artwork.objects.values_list('exhibition_id', flat=True)), {'ex-intake-a', 'ex-intake-b'})
        self.assertEqual(Artwork.objects.filter(title='같은 제목').count(), 2)
        self.assertEqual(Artwork.objects.get(pk='intake-a1').image_file, 'intake-a1.png')

    def test_corrupt_missing_unsafe_and_fake_image_rejected_before_write(self):
        baseline = copy.deepcopy(self.data)
        for mutation in ['hash', 'missing', 'traversal', 'absolute', 'signature']:
            with self.subTest(mutation=mutation):
                self.data = copy.deepcopy(baseline); row = self.data['items'][0]
                (self.root / 'intake-a1.png').write_bytes(PNG)
                if mutation == 'hash': row['sha256'] = '0' * 64
                if mutation == 'missing': row['file'] = 'missing.png'
                if mutation == 'traversal': row['file'] = '../escape.png'
                if mutation == 'absolute': row['file'] = '/tmp/escape.png'
                if mutation == 'signature':
                    (self.root / row['file']).write_bytes(b'not an image')
                    row['sha256'] = hashlib.sha256(b'not an image').hexdigest()
                with self.assertRaises(CommandError): self.run_import(True)
                self.assert_empty()

    def test_approval_layout_and_bad_pairing_cannot_be_imported(self):
        baseline = copy.deepcopy(self.data)
        for mutation in ['approved', 'confirmed', 'layout', 'pairs', 'duplicates', 'date', 'future', 'real_exhibition']:
            with self.subTest(mutation=mutation):
                self.data = copy.deepcopy(baseline); row = self.data['items'][0]
                if mutation == 'approved': row['reviewStatus'] = 'approved'
                if mutation == 'confirmed': row['summaryStatus'] = 'confirmed'
                if mutation == 'layout': row['position'] = {'x': 1, 'y': 2}
                if mutation == 'pairs': row['guide']['hints'] = []
                if mutation == 'duplicates': self.data['items'].append(copy.deepcopy(row))
                if mutation == 'date': self.data['exhibition']['endDate'] = '2020-01-01'
                if mutation == 'future': self.data['version'] = 2
                if mutation == 'real_exhibition': self.data['exhibition']['kind'] = 'official_exhibition'
                with self.assertRaises(CommandError): self.run_import()
                self.assert_empty()

    def test_existing_media_never_overwritten(self):
        target = self.media / 'intake-a1.png'; target.write_bytes(b'original')
        with self.assertRaises(CommandError): self.run_import(True)
        self.assertEqual(target.read_bytes(), b'original'); self.assertFalse(Exhibition.objects.exists())

    def test_failure_rolls_back_rows_and_only_new_files(self):
        row = copy.deepcopy(self.data['items'][0]); row.update(id='intake-a2', recordId='record-a2', assetId='asset-a2', file='intake-a2.png')
        self.data['items'].append(row); (self.root / row['file']).write_bytes(PNG)
        survivor = self.media / 'unrelated.png'; survivor.write_bytes(b'original')
        original = Artwork.save
        def save(work, *args, **kwargs):
            if work.id == 'intake-a2': raise RuntimeError('synthetic DB write failure')
            return original(work, *args, **kwargs)
        with patch.object(Artwork, 'save', save), self.assertRaises(RuntimeError): self.run_import()
        self.assertFalse(Exhibition.objects.exists()); self.assertFalse(Artwork.objects.exists())
        self.assertEqual(list(self.media.iterdir()), [survivor]); self.assertEqual(survivor.read_bytes(), b'original')

    def test_input_file_changed_after_preflight_rolls_back(self):
        from arti.management.commands import import_exhibition_bundle as module
        original = module.local_image; calls = []
        def change(root, row):
            calls.append(True)
            if len(calls) == 2: (root / row['file']).write_bytes(b'changed after dry validation')
            return original(root, row)
        with patch.object(module, 'local_image', change), self.assertRaises(CommandError): self.run_import()
        self.assert_empty()

    def test_output_failure_after_commit_keeps_committed_media(self):
        (self.root / 'manifest.json').write_text(json.dumps(self.data), encoding='utf-8')
        output = io.StringIO()
        with patch.object(output, 'write', side_effect=BrokenPipeError('synthetic output failure')):
            with self.assertRaises(BrokenPipeError):
                call_command('import_exhibition_bundle', str(self.root), stdout=output)
        self.assertTrue(Artwork.objects.filter(pk='intake-a1').exists())
        self.assertEqual((self.media / 'intake-a1.png').read_bytes(), PNG)
