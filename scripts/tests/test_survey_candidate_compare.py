# 빈도 동점과 쌍 비교의 공통 특징 상쇄를 검증합니다. 실제 사용자 선호 정답은 가정하지 않습니다.
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from survey_candidate_compare import preference, recommendation_priority_probe
from types import SimpleNamespace

TAGS = ('landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft')


def fixture(left, right):
    ids = [str(i) for i in range(10)]
    rows = {key: {'tags': {t: (left if int(key) % 2 == 0 else right).get(t, 0) for t in TAGS}} for key in ids}
    return ids, rows


class PreferenceComparisonTests(unittest.TestCase):
    def test_unknown_mode_is_not_silently_treated_as_a_contrast_experiment(self):
        ids, rows = fixture({'people': .9}, {})
        with self.assertRaises(ValueError):
            preference((0,)*5, ids, rows, TAGS, 'misspelled-mode')

    def test_priority_probe_changes_only_the_equal_weight_coverage_choice(self):
        works = [SimpleNamespace(id='a', tag_scores={'landscape': 1., 'people': 0.}, position_x=0, position_y=0),
                 SimpleNamespace(id='b', tag_scores={'landscape': 0., 'people': 1.}, position_x=0, position_y=0)]
        ex = SimpleNamespace(entrance_x=0, entrance_y=0)
        a = recommendation_priority_probe(works, ex, ['landscape', 'people'], {'landscape': .5, 'people': .5}, 1, ['landscape', 'people'])
        b = recommendation_priority_probe(works, ex, ['landscape', 'people'], {'landscape': .5, 'people': .5}, 1, ['people', 'landscape'])
        self.assertEqual([r['artworkId'] for r in a], ['a'])
        self.assertEqual([r['artworkId'] for r in b], ['b'])
        self.assertEqual(a[0]['score'], b[0]['score'])

    def test_equal_frequency_top3_uses_actual_score_sum_not_tag_order(self):
        ids, rows = fixture({'landscape': .51, 'people': .6, 'abstract': .8, 'warm': .9}, {})
        selected, counts, override = preference((0,)*5, ids, rows, TAGS, 'top3_frequency_then_ai_sum')
        self.assertEqual(selected, ['warm', 'abstract', 'people'])
        self.assertEqual(counts['landscape'], 5)
        self.assertIsNone(override)

    def test_contrast_cancels_shared_category_and_normalizes_positive_difference(self):
        ids, rows = fixture({'people': .9, 'warm': .8}, {'people': .9, 'warm': .2})
        current, _, _ = preference((0,)*5, ids, rows, TAGS, 'current_all_frequency')
        selected, _, weights = preference((0,)*5, ids, rows, TAGS, 'top3_signed_opponent_contrast')
        self.assertIn('people', current)
        self.assertEqual(selected, ['warm'])
        self.assertEqual(weights, {'warm': 1.0})

    def test_equal_opponents_do_not_invent_a_positive_preference(self):
        ids, rows = fixture({'people': .9}, {'people': .9})
        selected, _, weights = preference((0,)*5, ids, rows, TAGS, 'top3_signed_opponent_contrast')
        self.assertEqual(selected, [])
        self.assertEqual(weights, {})

    def test_current_frequency_does_not_silently_cap_the_existing_eight_tags(self):
        ids, rows = fixture({t: .8 for t in TAGS}, {})
        selected, counts, _ = preference((0,)*5, ids, rows, TAGS, 'current_all_frequency')
        self.assertEqual(selected, list(TAGS))
        self.assertTrue(all(counts[t] == 5 for t in TAGS))


if __name__ == '__main__':
    unittest.main()
