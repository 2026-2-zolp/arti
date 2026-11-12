# 실제 로드한 고정 CLIP 캐시와 분석 입력/보정값의 근거를 구성합니다. 다운로드·승인·DB 저장은 하지 않습니다.
from __future__ import annotations

import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import math
from pathlib import Path, PurePosixPath
import re

from .tags import TAG_KEYS, TAGS

SHA256 = re.compile(r'[a-f0-9]{64}')
REVISION = re.compile(r'[a-f0-9]{40}')
MODEL_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}')
PROCESSOR_FILES = ('preprocessor_config.json', 'processor_config.json', 'tokenizer_config.json',
                   'tokenizer.json', 'vocab.json', 'merges.txt', 'special_tokens_map.json', 'added_tokens.json')
RUNTIME_PACKAGES = ('torch', 'transformers', 'Pillow', 'tokenizers', 'safetensors')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def file_digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def snapshot_manifest(root, model_id, revision):
    """완전한 단일 가중치 형식의 HF snapshot만 인정하고 경로나 파일내용을 응답하지 않습니다."""
    if not MODEL_ID.fullmatch(model_id) or not REVISION.fullmatch(revision or ''):
        return None
    root = Path(root)
    if root.name != revision or root.parent.name != 'snapshots' or root.parent.parent.name != 'models--'+model_id.replace('/', '--'):
        return None
    try:
        required = ('config.json', 'preprocessor_config.json', 'tokenizer_config.json',
                    'vocab.json', 'merges.txt', 'special_tokens_map.json')
        if not all((root/name).is_file() for name in required):
            return None
        formats = []
        for name in ('model.safetensors', 'pytorch_model.bin', 'model.safetensors.index.json', 'pytorch_model.bin.index.json'):
            if (root/name).is_file(): formats.append(name)
        if len(formats) != 1:
            return None  # 두 형식이 있으면 어느 것을 로드했는지 추정하지 않습니다.
        weight = formats[0]
        weights = [weight]
        if weight.endswith('.index.json'):
            if (root/weight).stat().st_size > 1024 * 1024: return None
            mapping = json.loads((root/weight).read_text(encoding='utf-8'))['weight_map']
            if not isinstance(mapping, dict) or not mapping: return None
            for shard in sorted(set(mapping.values())):
                path = PurePosixPath(shard)
                if (len(path.parts) != 1 or path.name != shard or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', shard)
                        or not shard.endswith(('.bin', '.safetensors'))):
                    return None
                weights.append(shard)
        processor = {name: file_digest(root/name) for name in PROCESSOR_FILES if (root/name).is_file()}
        model = {name: file_digest(root/name) for name in ['config.json', *weights]}
        return {'modelId': model_id, 'modelRevision': revision, 'weightFormat': 'safetensors' if weight.startswith('model.safetensors') else 'pytorch',
                'artifactManifestSha256': digest({'model': model, 'processor': processor}),
                'processorManifestSha256': digest(processor)}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def cached_snapshot(model_id, revision):
    """문서화된 cache-only 조회를 사용합니다. 캐시가 없으면 네트워크 없이 결측을 반환합니다."""
    if not MODEL_ID.fullmatch(model_id) or not REVISION.fullmatch(revision or ''):
        return None
    try:
        from huggingface_hub import try_to_load_from_cache
        filename = try_to_load_from_cache(model_id, 'config.json', revision=revision)
        if not isinstance(filename, str): return None
        root = Path(filename).parent  # resolve하면 snapshot symlink가 blobs로 바뀌므로 경로를 유지합니다.
        manifest = snapshot_manifest(root, model_id, revision)
        return (root, manifest) if manifest else None
    except (ImportError, OSError, ValueError):
        return None


def runtime_versions():
    try:
        return {name: version(name) for name in RUNTIME_PACKAGES}
    except PackageNotFoundError:
        return None


def loaded_provenance(manifest):
    versions = runtime_versions()
    if versions is None: return None
    return {**manifest, 'runtimeVersions': versions}


def build_tag_evidence(model, image_sha256, scores, thresholds):
    """실제 이미지 점수에만 근거를 붙입니다. 출처 불명·텍스트/외부 URL 입력은 null 호환입니다."""
    if not isinstance(model, dict) or not isinstance(image_sha256, str) or not SHA256.fullmatch(image_sha256):
        return None
    try:
        if (not MODEL_ID.fullmatch(model['modelId']) or not REVISION.fullmatch(model['modelRevision'])
                or not SHA256.fullmatch(model['artifactManifestSha256']) or not SHA256.fullmatch(model['processorManifestSha256'])):
            return None
        if (not isinstance(model['runtimeVersions'], dict) or set(model['runtimeVersions']) != set(RUNTIME_PACKAGES)
                or any(not isinstance(v, str) or not v for v in model['runtimeVersions'].values())):
            return None
        if not isinstance(scores, dict) or set(scores) != set(TAG_KEYS) or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in scores.values()):
            return None
        # 버전명뿐 아니라 현재 실행 단위의 프롬프트·계산/디코드 정의를 묶습니다.
        code_files = ('analyzer.py', 'image_fetch.py', 'provenance.py')
        definition = {'prompts': TAGS, 'processor': model['processorManifestSha256'],
                      'artifact': model['artifactManifestSha256'], 'libraries': model['runtimeVersions'],
                      'code': {name: hashlib.sha256(Path(__file__).with_name(name).read_text(encoding='utf-8').encode('utf-8')).hexdigest()
                               for name in code_files}}
        signature = {'modelId': model['modelId'], 'modelRevision': model['modelRevision'],
                     'promptPreprocessSha256': digest(definition), 'calibrationSha256': digest(thresholds),
                     'tagDefinitionVersion': 'arti-eight-tags-v1', 'scoreDefinitionVersion': 'image-calibrated-tag-v1'}
        value = {'version': 1, 'tagSource': 'image', 'imageSha256': image_sha256,
                 'modelArtifactSha256': model['artifactManifestSha256'], 'signature': signature,
                 'signatureSha256': digest(signature), 'scoresSha256': digest({k: float(v) for k, v in scores.items()})}
        return value | {'evidenceSha256': digest(value)}
    except (OSError, ValueError, KeyError, TypeError):
        return None
