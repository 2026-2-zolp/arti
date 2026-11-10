# 제품 적용 없이 동점 계약의 경계·불변성·구형 저장 호환 반례를 검증합니다.
import copy
import itertools
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from taste_tie_contract import (RECORD, TAGS, SpecError, case_request, evidence_version,
                                fingerprint, resolve, score_units, verify_cases)


class TasteTieContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = json.loads((RECORD / 'cases.json').read_text(encoding='utf-8'))

    def request(self, case_id='TC01'):
        return case_request(self.records, next(c for c in self.records['cases'] if c['id'] == case_id))

    def test_thirty_named_counterexamples_and_read_only_requests(self):
        result = verify_cases()
        self.assertEqual(len(result['cases']), 30)
        self.assertTrue(all(x['passed'] for x in result['cases']))

    def test_user_array_order_cannot_invent_a_rank_or_change_weights(self):
        request = self.request()
        baseline = resolve(request)
        for order in itertools.permutations(request['selectedTags']):
            trial = copy.deepcopy(request); trial['selectedTags'] = list(order)
            self.assertEqual(resolve(trial), baseline)

    def test_pick_iteration_order_cannot_change_integer_score_totals(self):
        request = self.request()
        baseline = resolve(request)
        for picks in itertools.permutations(request['picks']):
            trial = copy.deepcopy(request); trial['picks'] = list(picks)
            self.assertEqual(resolve(trial), baseline)

    def test_quantization_boundary_and_invalid_scores_are_explicit(self):
        self.assertEqual(score_units(0), 0)
        self.assertEqual(score_units(.70000049), 700000)
        self.assertEqual(score_units(.70000050), 700001)
        for invalid in (None, True, '0.7', -1, 1.01, float('nan'), float('inf')):
            self.assertIsNone(score_units(invalid))
        request = self.request()
        current = evidence_version(request['poolRows'], request['approvedSignature'], request['currentPoolVersion'])
        request['poolRows'][0]['scores']['light'] = .70000049
        self.assertEqual(current, evidence_version(request['poolRows'], request['approvedSignature'], request['currentPoolVersion']))
        request['poolRows'][0]['scoreRevision'] += 1
        self.assertNotEqual(current, evidence_version(request['poolRows'], request['approvedSignature'], request['currentPoolVersion']))

    def test_all_eight_selected_tags_are_kept_without_top_three_cut(self):
        request = self.request()
        request['selectedTags'] = list(TAGS)
        for row in request['poolRows']: row['tags'] = list(TAGS)
        request['evidenceVersion'] = evidence_version(request['poolRows'], request['approvedSignature'], request['currentPoolVersion'])
        output = resolve(request)
        self.assertEqual(set(output['tagOrder']), set(TAGS))
        self.assertEqual(len(output['tagOrder']), 8)
        self.assertEqual(set(output['counts'].values()), {5})
        self.assertAlmostEqual(sum(output['weights'].values()), 1)

    def test_legacy_saved_usage_does_not_require_current_pool_or_any_model_data(self):
        request = self.request('TC16')
        for key in ('poolRows', 'picks', 'poolVersion', 'currentPoolVersion', 'evidenceVersion', 'approvedSignature', 'ready'):
            request.pop(key)
        before = fingerprint(request)
        self.assertEqual(resolve(request)['tagOrder'], ['people', 'light', 'warm'])
        self.assertEqual(fingerprint(request), before)

    def test_missing_legacy_counts_keep_unit_weight_and_bad_stored_data_is_not_rewritten(self):
        request = self.request('TC16')
        request['serverSnapshot']['counts'] = {'people': 5}
        output = resolve(request)
        self.assertEqual(output['weights'], {'people': 5/7, 'light': 1/7, 'warm': 1/7})
        request['serverSnapshot']['counts']['warm'] = True
        before = fingerprint(request)
        with self.assertRaisesRegex(SpecError, 'STORED_PROFILE_REVIEW_REQUIRED'): resolve(request)
        self.assertEqual(fingerprint(request), before)

    def test_unknown_profile_schema_requires_review_not_silent_migration(self):
        request = self.request('TC16'); request['serverSnapshot']['version'] = 99
        with self.assertRaisesRegex(SpecError, 'STORED_PROFILE_REVIEW_REQUIRED'): resolve(request)
        request = self.request('TC16'); request['savedProfileVersion'] = True
        with self.assertRaisesRegex(SpecError, 'VALIDATION_ERROR'): resolve(request)
        for invalid in (False, [], 'legacy'):
            request = self.request('TC16'); request['serverSnapshot'] = invalid
            with self.assertRaisesRegex(SpecError, 'STORED_PROFILE_REVIEW_REQUIRED'): resolve(request)

    def test_nonfinite_score_falls_back_for_whole_tie_group(self):
        request = self.request(); request['poolRows'][0]['scores']['warm'] = float('nan')
        request['evidenceVersion'] = evidence_version(request['poolRows'], request['approvedSignature'], request['currentPoolVersion'])
        output = resolve(request)
        self.assertEqual(output['tagOrder'], ['people', 'light', 'warm'])
        self.assertEqual(output['groups'][0]['rule'], 'canonical_fallback')


if __name__ == '__main__':
    unittest.main()
