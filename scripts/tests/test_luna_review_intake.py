import csv
import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from luna_review_intake import COLUMNS, check_review, compare_reviews, read_review


class LunaReviewIntakeTests(unittest.TestCase):
    manifest = {'cases': [{'id': case} for case in ('L01', 'L02', 'L03')]}

    def sheet(self, *rows):
        sheet = io.StringIO(newline='')
        csv.writer(sheet).writerows([COLUMNS, *rows])
        sheet.seek(0)
        return sheet

    def check_rows(self, *rows):
        return check_review(self.sheet(*rows), self.manifest)

    def test_blank_template_keeps_all_pairs_pending(self):
        result = self.check_rows(('L01-summary-1', 'X', '', '', '', '', ''))
        self.assertEqual(result['completePairs'], 0)
        self.assertEqual(result['totalPairs'], 12)
        self.assertEqual(result['byVerdict']['unreviewed'], 24)

    def test_partial_sheet_reports_pairs_without_exposing_notes(self):
        result = self.check_rows(
            ('L01-summary-1', 'X', 2, 1, '초안 활용 가능', '', '원전, 첫 문장\n두 번째 줄'),
            ('L01-summary-1', 'Y', 2, 2, '실패', '틀린 위치', '도판 오른쪽'),
            ('L02-guide-2', 'X', '', '', '보류', '', '도판 확인 예정'),
            ('L02-guide-2', 'Y', 1, 1, '수정', '', '힌트에 관찰 대상 추가'),
        )
        self.assertEqual(result['completePairs'], 1)
        self.assertEqual(result['byVerdict'], {'usable': 1, 'revise': 1, 'failed': 1, 'hold': 1, 'unreviewed': 20})
        self.assertIn({'trialId': 'L02-guide-2', 'sides': ['X']}, result['pendingPairs'])
        self.assertNotIn('틀린 위치', str(result))

    def test_duplicate_or_unknown_label_does_not_increase_coverage(self):
        row = ('L01-summary-1', 'X', '', '', '', '', '')
        for rows in [(row, row), (('L01-summary-1', 'Z', '', '', '', '', ''),)]:
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, 'unknown or duplicate'):
                self.check_rows(*rows)

    def test_two_reviewers_keep_pending_separate_and_only_report_disagreement_labels(self):
        first = self.sheet(
            ('L01-summary-1', 'X', 2, 2, '초안 활용 가능', '', '비공개 근거'),
            ('L01-summary-1', 'Y', 0, 2, '실패', '비공개 문장', '원문 근거'),
            ('L02-guide-2', 'X', '', '', '보류', '', '자료 확인 대기'),
        )
        second = self.sheet(
            ('L01-summary-1', 'X', 2, 1, '초안 활용 가능', '', '비공개 근거'),
            ('L01-summary-1', 'Y', 1, 1, '수정', '', '도판 근거'),
            ('L02-guide-2', 'X', 2, 2, '초안 활용 가능', '', '도판 근거'),
        )
        result = compare_reviews(read_review(first, self.manifest), read_review(second, self.manifest))
        self.assertEqual(result, {'agreeingSides': 1, 'pendingSides': 22, 'disagreements': [
            {'trialId': 'L01-summary-1', 'side': 'Y', 'first': 'failed', 'second': 'revise'},
        ]})
        self.assertNotIn('비공개', str(result))

    def test_missing_evidence_invalid_grade_and_threshold_are_rejected(self):
        for scores, verdict, quote, evidence in [
            ((2, 2), '초안 활용 가능', '', ''),
            ((0, 1), '초안 활용 가능', '', '요약'),
            ((2, 2), '실패', '', '도판'),
            (('', 1), '보류', '', '도판 확인 예정'),
            ((0, 3), '수정', '', '근거'),
        ]:
            with self.subTest(scores=scores, verdict=verdict), self.assertRaises(ValueError):
                self.check_rows(('L03-guide-1', 'Y', *scores, verdict, quote, evidence))
