# 익명 검수의 노출 경계·좌우 반전·미응답·변조·시험 응답 보호를 검증합니다.
import copy
import json
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from survey_blind_review import ROOT, REVIEW, build_pack, make_manifest, template, validate_matrix, validate_response


class BlindReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matrix = json.loads((REVIEW / 'matrix.json').read_text(encoding='utf-8'))
        cls.manifest, cls.mapping = make_manifest(cls.matrix)

    def answer(self, complete=False):
        data = template(self.manifest, 'V1')
        data.update(reviewerAlias='R01', createdAt='2026-11-10T18:00:00+09:00')
        if complete:
            data.update(status='submitted', independentResponse=True)
            data['exposure'] = {k: 'no' for k in data['exposure']}
            for row in data['items']:
                row.update(quality='unsure', familiarity='unsure')
            for row in data['pairs']:
                row.update(choice='unsure', difference='unsure', qualityInfluence='unsure')
        return data

    def test_reviewer_payload_has_no_manager_identifiers_titles_or_hypotheses(self):
        payload = json.dumps(self.manifest, ensure_ascii=False)
        for row in self.matrix['items']:
            for key in ('id', 'title', 'assetPath', 'sourceUrl'):
                self.assertNotIn(row[key], payload)
        for row in self.matrix['pairs']:
            self.assertNotIn(row['contrastHypothesis'], payload)
        self.assertNotIn('score', payload.lower())

    def test_variants_reverse_order_and_swap_every_pair_without_adding_respondents(self):
        a, b = (self.manifest['variants'][k] for k in ('V1', 'V2'))
        self.assertEqual(a['itemOrder'], list(reversed(b['itemOrder'])))
        for left, right in zip(a['pairs'], reversed(b['pairs'])):
            self.assertEqual((left['code'], left['left'], left['right']),
                             (right['code'], right['right'], right['left']))
        self.assertEqual(len(self.mapping['items']), 21)

    def test_blank_is_draft_not_negative_and_cannot_be_submitted(self):
        data = self.answer()
        result = validate_response(data, self.manifest)
        self.assertEqual(result['completeItems'], 0)
        self.assertEqual(result['completePairs'], 0)
        data['status'] = 'submitted'
        with self.assertRaises(ValueError):
            validate_response(data, self.manifest)

    def test_uncertain_complete_answers_are_not_approval_or_accuracy(self):
        result = validate_response(self.answer(True), self.manifest)
        self.assertEqual(result['completePairs'], 18)
        self.assertFalse(result['contentApproved'])
        self.assertFalse(result['preferenceAccuracyMeasured'])
        self.assertFalse(result['independenceVerified'])

    def test_exposed_responses_are_preserved_not_pretended_independent(self):
        data = self.answer(True)
        data['exposure']['modelResults'] = 'yes'
        self.assertFalse(validate_response(data, self.manifest)['unexposedSelfReport'])

    def test_order_orientation_hash_missing_and_extra_rows_rejected(self):
        for mutation in ('order', 'orientation', 'hash', 'missing', 'extra', 'duplicate'):
            with self.subTest(mutation=mutation):
                data = self.answer(True)
                if mutation == 'order': data['items'].reverse()
                if mutation == 'orientation': data['pairs'][0]['left'] = data['pairs'][0]['right']
                if mutation == 'hash': data['items'][0]['sha256'] = '0' * 64
                if mutation == 'missing': data['items'].pop()
                if mutation == 'extra': data['items'][0]['modelScore'] = .9
                if mutation == 'duplicate': data['pairs'][1] = copy.deepcopy(data['pairs'][0])
                with self.assertRaises(ValueError): validate_response(data, self.manifest)

    def test_test_responses_require_explicit_separate_validation(self):
        data = self.answer(True); data['reviewerAlias'] = 'TEST01'
        with self.assertRaises(ValueError): validate_response(data, self.manifest)
        data['forTesting'] = True
        with self.assertRaises(ValueError): validate_response(data, self.manifest)
        self.assertTrue(validate_response(data, self.manifest, allow_test=True)['forTesting'])

    def test_digest_unknown_variant_invalid_type_and_long_note_rejected(self):
        for key, value in [('packDigest', 'bad'), ('variant', 'V3'), ('version', True), ('independentResponse', 'true')]:
            data = self.answer(True); data[key] = value
            with self.assertRaises(ValueError): validate_response(data, self.manifest)
        data = self.answer(); data['items'][0]['note'] = 'a' * 2001
        with self.assertRaises(ValueError): validate_response(data, self.manifest)

    def test_matrix_rejects_approval_duplicate_pair_and_path_escape(self):
        for mutation in ('active', 'pair', 'path'):
            matrix = copy.deepcopy(self.matrix)
            if mutation == 'active': matrix['activation'] = True
            if mutation == 'pair': matrix['pairs'][1] = matrix['pairs'][0]
            if mutation == 'path': matrix['items'][0]['assetPath'] = '../outside.png'
            with self.assertRaises(ValueError): validate_matrix(matrix)

    def test_build_refuses_existing_output_and_nonprivate_destination(self):
        for path in (ROOT / 'data/private', ROOT / 'docs/review/new-output'):
            with self.subTest(path=str(path)):
                with self.assertRaises(ValueError): build_pack(self.matrix, path)

    def test_changed_image_is_rejected_before_any_output_is_created(self):
        matrix = copy.deepcopy(self.matrix)
        matrix['items'][0]['sha256'] = '0' * 64
        output = ROOT / 'data/private' / ('TEST-blind-no-output-' + uuid.uuid4().hex)
        with self.assertRaisesRegex(ValueError, 'image hash mismatch'):
            build_pack(matrix, output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
