import unittest

from scripts.normalize_openai_usage import normalize


def export(*rows):
    return {'has_more': False, 'next_page': None, 'data': [
        {'start_time': start, 'end_time': end, 'results': results} for start, end, results in rows
    ]}


class OpenAIUsageExportTests(unittest.TestCase):
    def test_combines_usage_buckets_and_preserves_missing_cached_counts(self):
        row = {'project_id': 'proj_test', 'model': 'gpt-6-luna', 'input_tokens': 100, 'output_tokens': 30}
        usage = export((0, 60, [row | {'input_cached_tokens': 0}]), (60, 120, [row]))
        report = normalize('proj_test', usage)
        self.assertEqual(report['rows'], [{'model': 'gpt-6-luna', 'inputTokens': 200,
                                          'outputTokens': 60, 'cachedInputTokens': None}])
        self.assertIsNone(report['billedCost'])

    def test_billing_is_project_scoped_and_keeps_decimal_amounts(self):
        costs = export((0, 86400, [{'project_id': 'proj_test', 'amount': {'value': '0.00430', 'currency': 'usd'}}]))
        report = normalize('proj_test', export((0, 86400, [])), costs)
        self.assertEqual(report['billedCost'], '0.00430')
        self.assertEqual(report['currency'], 'USD')
        with self.assertRaisesRegex(ValueError, 'same interval'):
            normalize('proj_test', export((0, 60, [])), costs)

    def test_rejects_partial_overlap_and_different_project(self):
        with self.assertRaisesRegex(ValueError, 'all pages'):
            normalize('proj_test', export((0, 60, [])) | {'has_more': True})
        with self.assertRaisesRegex(ValueError, 'contiguous'):
            normalize('proj_test', export((0, 60, []), (50, 120, [])))
        with self.assertRaisesRegex(ValueError, 'grouped by'):
            normalize('proj_test', export((0, 60, [{'project_id': 'different', 'model': 'gpt-6-luna'}])))
