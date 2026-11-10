# DB 없이 실제 로컬 HTTP로 새 점수 근거·구형 응답·저장 경계 호환을 검사합니다.
import hashlib
import json
from pathlib import Path
import tempfile

from django.conf import settings
from django.test import SimpleTestCase, override_settings

from arti import model_service, providers
from arti.http import ContractError
from arti.tests.test_model_service import result
from arti.tests.test_provider import endpoint


def packet(content=b'synthetic-image'):
    value = result(); value['models']['image'] = 'fixture/clip-test'
    signature = {'modelId': value['models']['image'], 'modelRevision': 'a'*40,
                 'promptPreprocessSha256': 'b'*64, 'calibrationSha256': 'c'*64,
                 'tagDefinitionVersion': 'arti-eight-tags-v1', 'scoreDefinitionVersion': 'image-calibrated-tag-v1'}
    evidence = {'version': 1, 'tagSource': 'image', 'imageSha256': hashlib.sha256(content).hexdigest(),
                'modelArtifactSha256': 'd'*64, 'signature': signature,
                'signatureSha256': model_service.evidence_digest(signature),
                'scoresSha256': model_service.evidence_digest(value['tags'])}
    value['tagEvidence'] = evidence | {'evidenceSha256': model_service.evidence_digest(evidence)}
    return value


class TagEvidenceTransportTests(SimpleTestCase):
    def analyze(self, value, content=b'synthetic-image'):
        with tempfile.TemporaryDirectory() as folder, endpoint(body=json.dumps(value).encode()) as requests:
            Path(folder, 'test.png').write_bytes(content)
            with override_settings(MEDIA_ROOT=Path(folder), ARTI_MODEL_SERVICE_URL=settings.OPENAI_BASE_URL.removesuffix('/v1')):
                response = model_service.analyze({'imageFile': 'test.png', 'description': '합성 원문'})
            self.assertEqual(set(requests[0]['body']), {'title', 'description', 'imageBase64'})
            return response

    def test_wire_evidence_is_validated_and_forwarded_only_with_tags(self):
        expected = packet(); value = self.analyze(expected)
        self.assertEqual(value['tagEvidence'], expected['tagEvidence'])
        with override_settings(ARTI_MODEL_SERVICE_URL='http://fixture.test'):
            cache = {'result': value}
            tag = providers.generate('tag', {}, analysis_cache=cache)
            emotion = providers.generate('emotion', {}, analysis_cache=cache)
        self.assertEqual(tag, {'scores': expected['tags'], 'tagEvidence': expected['tagEvidence']})
        self.assertNotIn('tagEvidence', emotion)
        self.assertNotIn('signature', emotion)
        self.assertIn('analyzedAt', emotion)

    def test_absent_and_explicit_null_old_responses_remain_compatible(self):
        for present in (False, True):
            value = result()
            if present: value['tagEvidence'] = None
            response = self.analyze(value)
            self.assertEqual(response['tags'], value['tags'])
            self.assertIsNone(response['tagEvidence'])

    def test_foreign_input_or_stale_score_cannot_be_paired_with_evidence(self):
        values = []
        item = packet(b'other-image'); values.append(item)
        item = packet(); item['tags']['warm'] = .9; values.append(item)
        item = packet(); item['models']['image'] = 'other/model'; values.append(item)
        item = packet(); item['tagSource'] = 'text'; values.append(item)
        for value in values:
            with self.subTest(value=value), self.assertRaises(ContractError) as error:
                self.analyze(value)
            self.assertEqual(error.exception.status_code, 502)

    def test_present_malformed_evidence_is_rejected_without_echoing_internal_values(self):
        variants = []
        for key, replacement in [('version', True), ('modelArtifactSha256', 'not-a-hash'),
                                  ('signatureSha256', '0'*64), ('scoresSha256', '0'*64),
                                  ('evidenceSha256', '0'*64), ('signature', []), ('imageSha256', None)]:
            value = packet(); value['tagEvidence'][key] = replacement; variants.append(value)
        value = packet(); value['tagEvidence']['signature']['modelRevision'] = 'main'; variants.append(value)
        value = packet(); value['tagEvidence']['signature']['scoreDefinitionVersion'] = 'emotion'; variants.append(value)
        value = packet(); value['tagEvidence']['privatePath'] = 'internal-path-sentinel'; variants.append(value)
        value = packet(); value['tagEvidence'].pop('version'); variants.append(value)
        value = packet(); value['tagEvidence'] = False; variants.append(value)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ContractError) as error:
                self.analyze(value)
            self.assertEqual(error.exception.status_code, 502)
            self.assertNotIn('internal-path-sentinel', str(error.exception))

    def test_integer_zero_scores_survive_json_float_normalization(self):
        value = packet()
        value['tags'] = {key: 0 for key in value['tags']}
        evidence = value['tagEvidence']
        evidence['scoresSha256'] = model_service.evidence_digest({key: 0.0 for key in value['tags']})
        evidence['evidenceSha256'] = model_service.evidence_digest({k: v for k, v in evidence.items() if k != 'evidenceSha256'})
        self.assertEqual(self.analyze(value)['tags'], value['tags'])
