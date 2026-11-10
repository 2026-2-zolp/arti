# 실제 가중치/다운로드 없이 입력 바이트·캐시 로드·부분 실패·근거 전달의 경계를 검증합니다.
import base64
import copy
import hashlib
import io
import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
import pytest

from app import main, provenance
from app.analyzer import HuggingFaceScorer
from app.tags import TAG_KEYS
from .test_api import FakeScorer

MODEL = 'fixture/clip-test'
REVISION = 'a' * 40
VERSIONS = {name: 'synthetic' for name in provenance.RUNTIME_PACKAGES}


def make_snapshot(tmp_path):
    root = tmp_path / 'models--fixture--clip-test' / 'snapshots' / REVISION
    root.mkdir(parents=True)
    for name in ('config.json', 'preprocessor_config.json', 'tokenizer_config.json', 'tokenizer.json',
                 'vocab.json', 'merges.txt', 'special_tokens_map.json'):
        (root/name).write_text('{}', encoding='utf-8')
    (root/'model.safetensors').write_bytes(b'synthetic-not-a-model')
    return root


def model_manifest():
    return {'modelId': MODEL, 'modelRevision': REVISION, 'artifactManifestSha256': 'b'*64,
            'processorManifestSha256': 'c'*64, 'runtimeVersions': dict(VERSIONS)}


def png_bytes(note):
    stream = io.BytesIO(); metadata = PngImagePlugin.PngInfo(); metadata.add_text('test', note)
    Image.new('RGB', (8, 8), (200, 50, 50)).save(stream, 'PNG', pnginfo=metadata)
    return stream.getvalue()


def test_snapshot_requires_complete_single_format_and_never_exports_path(tmp_path):
    root = make_snapshot(tmp_path)
    manifest = provenance.snapshot_manifest(root, MODEL, REVISION)
    assert manifest and manifest['modelRevision'] == REVISION
    assert str(tmp_path) not in json.dumps(manifest)
    (root/'pytorch_model.bin').write_bytes(b'other-format')
    assert provenance.snapshot_manifest(root, MODEL, REVISION) is None
    (root/'pytorch_model.bin').unlink()
    (root/'merges.txt').unlink()
    assert provenance.snapshot_manifest(root, MODEL, REVISION) is None


def test_shard_paths_and_missing_shards_are_not_inferred(tmp_path):
    root = make_snapshot(tmp_path); (root/'model.safetensors').unlink()
    index = root/'model.safetensors.index.json'
    for shard in ('../outside.safetensors', '..\\outside.safetensors', 'C:\\private.safetensors', 'missing.safetensors'):
        index.write_text(json.dumps({'weight_map': {'test': shard}}))
        assert provenance.snapshot_manifest(root, MODEL, REVISION) is None
    shard = 'model-00001-of-00001.safetensors'
    index.write_text(json.dumps({'weight_map': {'test': shard}})); (root/shard).write_bytes(b'synthetic')
    assert provenance.snapshot_manifest(root, MODEL, REVISION)


def test_cache_lookup_is_offline_and_unpinned_local_paths_remain_unknown(tmp_path):
    root = make_snapshot(tmp_path)
    lookup = Mock(return_value=str(root/'config.json'))
    module = SimpleNamespace(try_to_load_from_cache=lookup, snapshot_download=Mock())
    with patch.dict(sys.modules, huggingface_hub=module):
        assert provenance.cached_snapshot(MODEL, None) is None
        assert provenance.cached_snapshot(str(root), REVISION) is None
        lookup.assert_not_called()
        assert provenance.cached_snapshot(MODEL, REVISION)[0] == root
        lookup.assert_called_once_with(MODEL, 'config.json', revision=REVISION)
        module.snapshot_download.assert_not_called()
        lookup.return_value = object()
        assert provenance.cached_snapshot(MODEL, REVISION) is None


def fake_transformers(fail_nli=False, mutate=None):
    def clip_load(*args, **kwargs):
        if mutate: mutate()
        return SimpleNamespace(eval=lambda: 'clip')
    return SimpleNamespace(CLIPModel=SimpleNamespace(from_pretrained=Mock(side_effect=clip_load)),
                           CLIPProcessor=SimpleNamespace(from_pretrained=Mock(return_value='processor')),
                           pipeline=Mock(side_effect=RuntimeError('NLI synthetic failure')) if fail_nli else Mock(return_value='nli'))


def test_model_processor_pin_same_cached_artifact_and_publish_once(tmp_path, monkeypatch):
    root = make_snapshot(tmp_path)
    before = provenance.snapshot_manifest(root, MODEL, REVISION)
    lookup = Mock(return_value=(root, before))
    monkeypatch.setattr('app.analyzer.cached_snapshot', lookup)
    monkeypatch.setattr(provenance, 'runtime_versions', lambda: dict(VERSIONS))
    module = fake_transformers(); scorer = HuggingFaceScorer(MODEL, 'fixture-nli', REVISION)
    assert scorer.tag_model_provenance is None
    with patch.dict(sys.modules, transformers=module):
        scorer.load(); scorer.load()
    module.CLIPModel.from_pretrained.assert_called_once_with(str(root), local_files_only=True, use_safetensors=True)
    module.CLIPProcessor.from_pretrained.assert_called_once_with(str(root), local_files_only=True)
    assert lookup.call_count == 1 and scorer.loaded
    value = scorer.tag_model_provenance; value['runtimeVersions']['torch'] = 'mutated'
    assert scorer.tag_model_provenance['runtimeVersions']['torch'] == 'synthetic'


def test_partial_load_has_no_metadata_and_retry_publishes_complete_state(tmp_path, monkeypatch):
    root = make_snapshot(tmp_path); before = provenance.snapshot_manifest(root, MODEL, REVISION)
    monkeypatch.setattr('app.analyzer.cached_snapshot', lambda *a: (root, before))
    monkeypatch.setattr(provenance, 'runtime_versions', lambda: dict(VERSIONS))
    module = fake_transformers(fail_nli=True); scorer = HuggingFaceScorer(MODEL, 'fixture-nli', REVISION)
    with patch.dict(sys.modules, transformers=module), pytest.raises(RuntimeError): scorer.load()
    assert not scorer.loaded and scorer._clip is None and scorer.tag_model_provenance is None
    module.pipeline = Mock(return_value='nli')
    with patch.dict(sys.modules, transformers=module): scorer.load()
    assert scorer.loaded and scorer.tag_model_provenance


@pytest.mark.parametrize('filename', ['model.safetensors', 'preprocessor_config.json', 'config.json', 'tokenizer.json'])
def test_files_changed_during_load_only_disable_evidence_not_legacy_scores(tmp_path, monkeypatch, filename):
    root = make_snapshot(tmp_path); before = provenance.snapshot_manifest(root, MODEL, REVISION)
    monkeypatch.setattr('app.analyzer.cached_snapshot', lambda *a: (root, before))
    module = fake_transformers(mutate=lambda: (root/filename).write_bytes(b'changed-during-load'))
    scorer = HuggingFaceScorer(MODEL, 'fixture-nli', REVISION)
    with patch.dict(sys.modules, transformers=module): scorer.load()
    assert scorer.loaded and scorer.tag_model_provenance is None


def test_uncached_model_still_passes_revision_to_both_loaders(monkeypatch):
    monkeypatch.setattr('app.analyzer.cached_snapshot', lambda *a: None)
    module = fake_transformers(); scorer = HuggingFaceScorer(MODEL, 'fixture-nli', REVISION)
    with patch.dict(sys.modules, transformers=module): scorer.load()
    module.CLIPModel.from_pretrained.assert_called_once_with(MODEL, revision=REVISION)
    module.CLIPProcessor.from_pretrained.assert_called_once_with(MODEL, revision=REVISION)
    assert scorer.loaded and scorer.tag_model_provenance is None


def test_api_binds_original_bytes_scores_and_actual_thresholds(monkeypatch):
    class Registered(FakeScorer):
        clip_name = MODEL
        tag_model_provenance = model_manifest()
    monkeypatch.setattr(main, 'scorer', Registered())
    thresholds = {t: .8 for t in TAG_KEYS}; monkeypatch.setattr(main, 'tag_thresholds', thresholds)
    client = TestClient(main.app)
    packets = []
    for label in ('first', 'same-pixels-different-bytes'):
        raw = png_bytes(label)
        response = client.post('/analyze', json={'description': '합성', 'imageBase64': base64.b64encode(raw).decode()})
        assert response.status_code == 200
        body = response.json(); ev = body['tagEvidence']; packets.append(body)
        assert ev['imageSha256'] == hashlib.sha256(raw).hexdigest()
        assert ev['scoresSha256'] == provenance.digest(body['tags'])
        assert ev['signature']['calibrationSha256'] == provenance.digest(thresholds)
        assert ev['signatureSha256'] == provenance.digest(ev['signature'])
        assert ev['evidenceSha256'] == provenance.digest({k: v for k, v in ev.items() if k != 'evidenceSha256'})
        assert body['models']['image'] == MODEL
        assert set(ev) == {'version', 'tagSource', 'imageSha256', 'modelArtifactSha256', 'signature', 'signatureSha256', 'scoresSha256', 'evidenceSha256'}
    assert packets[0]['tags'] == packets[1]['tags']
    assert packets[0]['tagEvidence']['imageSha256'] != packets[1]['tagEvidence']['imageSha256']
    assert thresholds == {t: .8 for t in TAG_KEYS}


def test_unregistered_text_and_url_inputs_cannot_claim_byte_provenance(monkeypatch):
    scorer = FakeScorer(); monkeypatch.setattr(main, 'scorer', scorer)
    monkeypatch.setattr(main, 'tag_thresholds', {})
    client = TestClient(main.app)
    raw = png_bytes('test')
    assert client.post('/analyze', json={'imageBase64': base64.b64encode(raw).decode()}).json()['tagEvidence'] is None
    scorer.tag_model_provenance = model_manifest()
    assert client.post('/analyze', json={'description': '원문'}).json()['tagEvidence'] is None
    monkeypatch.setattr(main, 'fetch_image', lambda url: Image.new('RGB', (8, 8)))
    assert client.post('/analyze', json={'imageUrl': 'https://example.test/test.png'}).json()['tagEvidence'] is None
    assert client.post('/analyze', json={'description': '원문', 'imageBase64': 'bad'}).json()['tagEvidence'] is None


def test_missing_library_or_bad_metadata_keeps_evidence_nullable(monkeypatch):
    monkeypatch.setattr(provenance, 'runtime_versions', lambda: None)
    assert provenance.loaded_provenance({}) is None
    assert provenance.build_tag_evidence({}, 'a'*64, {t: .5 for t in TAG_KEYS}, {}) is None
    scores = {t: 0 for t in TAG_KEYS}
    value = provenance.build_tag_evidence(model_manifest(), 'a'*64, scores, {})
    assert value['scoresSha256'] == provenance.digest({t: 0.0 for t in TAG_KEYS})
    broken = copy.deepcopy(model_manifest()); broken['modelRevision'] = 'main'
    assert provenance.build_tag_evidence(broken, 'a'*64, scores, {}) is None
    broken = copy.deepcopy(model_manifest()); broken['runtimeVersions'].pop('torch')
    assert provenance.build_tag_evidence(broken, 'a'*64, scores, {}) is None


def test_response_uses_same_threshold_snapshot_as_scoring(monkeypatch):
    class Mutating(FakeScorer):
        clip_name = MODEL
        tag_model_provenance = model_manifest()
        def image_tag_scores(self, image):
            main.tag_thresholds['landscape'] = .99
            return super().image_tag_scores(image)
    before = {t: .8 for t in TAG_KEYS}
    monkeypatch.setattr(main, 'tag_thresholds', dict(before))
    monkeypatch.setattr(main, 'scorer', Mutating())
    with TestClient(main.app) as client:
        body = client.post('/analyze', json={'imageBase64': base64.b64encode(png_bytes('threshold')).decode()}).json()
    assert body['tagEvidence']['signature']['calibrationSha256'] == provenance.digest(before)
    assert body['tags']['landscape'] == .75  # .9를변경전.8기준으로보정
