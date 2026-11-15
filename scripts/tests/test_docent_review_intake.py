import json
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docent_review_intake import ANSWER_HASH, ANSWERS_SHA256, COLUMNS, EXPOSURE, REVIEWED_ON, REVIEWER, read_archive, report


def fixture_reply(answers, reviewer, exposure, edits=None, omitted=()):
    header = [
        '## 제출표', f'- {REVIEWER} · {reviewer}', f'- {REVIEWED_ON} · 2026-11-16',
        f'- {EXPOSURE} · {exposure}', f'- {ANSWER_HASH} · `{ANSWERS_SHA256}`',
        '| ' + ' | '.join(COLUMNS) + ' |', '| ' + ' | '.join(['---'] * len(COLUMNS)) + ' |',
    ]
    for case, answer in answers.items():
        if case in omitted:
            continue
        scores = ('—', '—', '—', '—') if case.endswith('-first') else (
            ('2', '2', '1', '1') if case.endswith('-followup') else ('2', '—', '—', '2')
        )
        excerpt = ' '.join(answer.split()[:4])
        values = dict(zip(COLUMNS, [case, *scores, '', '충족', '없음', '통과', f'{excerpt} → 합성 원문과 질문']))
        values.update((edits or {}).get(case, {}))
        header.append('| ' + ' | '.join(values.values()) + ' |')
    return '\n'.join(header)


class DocentReviewIntakeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.refs, cls.answers = read_archive()

    def review(self, *texts):
        return report(self.refs, self.answers, texts)

    def test_archive_and_complete_markdown(self):
        text = fixture_reply(self.answers, '검수 A', '미열람', {'D01-followup': {'평균': '1.5/2'}})
        result = self.review(text)
        self.assertEqual(result['caseCount'], 12)
        self.assertEqual(result['archive']['answersSha256'], ANSWERS_SHA256)
        self.assertEqual(result['priorReviewExposureCounts'], {'미열람': 1})
        reply, = result['replies']
        self.assertFalse(reply['issues'])
        self.assertTrue(all(not row['issues'] for row in reply['cases'].values()))
        self.assertIsNone(reply['cases']['D01-first']['mean'])
        self.assertEqual(reply['cases']['D01-followup']['mean'], 1.5)
        self.assertEqual(reply['cases']['B01']['mean'], 2)
        self.assertNotIn('합성 원문과 질문', json.dumps(result, ensure_ascii=False))

    def test_missing_fields_and_inconsistent_scores_are_flagged(self):
        text = fixture_reply(self.answers, '검수 A', '미열람', {
            'D01-first': {'근거': '2', '판정': '', '판단 문장과 근거': ''},
            'D02-followup': {'근거': '3', '평균': '1.5'},
            'B01': {'명료성': '0', '중대 위반': '있음', '판단 문장과 근거': '다른 답변 → 대조 자료'},
            'B02': {'명료성': '0', '판정': '통과'},
        }, omitted=('D04-followup',))
        rows = self.review(text)['replies'][0]['cases']
        self.assertEqual(rows['D04-followup']['issues'], ['missing-case'])
        self.assertCountEqual(rows['D01-first']['issues'], [
            '근거-not-applicable', 'decision-required', 'missing-evidence-or-needed-material', 'missing-answer-excerpt',
        ])
        self.assertCountEqual(rows['D02-followup']['issues'], ['근거-score-required-0-to-2', 'mean-mismatch'])
        self.assertCountEqual(rows['B01']['issues'], ['decision-mismatch', 'answer-excerpt-not-found'])
        self.assertEqual(rows['B02']['issues'], ['decision-mismatch'])

    def test_hold_records_needed_evidence_without_turning_it_into_a_decision(self):
        text = fixture_reply(self.answers, '검수 A', '모름', {'B01': {
            '근거': '', '명료성': '', '필수 행동': '', '중대 위반': '', '판정': '보류',
            '판단 문장과 근거': '→ 출처 목록의 누락 여부 확인 필요',
        }})
        result = self.review(text)
        self.assertFalse(result['replies'][0]['cases']['B01']['issues'])
        self.assertEqual(result['caseSummary']['B01']['recordableReplies'], 1)
        self.assertEqual(result['caseSummary']['B01']['held'], 1)
        self.assertEqual(result['caseSummary']['B01']['decisionCounts'], {})

    def test_disagreement_and_prior_review_exposure_remain_visible(self):
        first = fixture_reply(self.answers, '검수 A', '미열람')
        second = fixture_reply(self.answers, '검수 B', '열람', {'D01-followup': {
            '근거': '0', '필수 행동': '미충족', '중대 위반': '있음', '판정': '실패',
        }})
        result = self.review(first, second)
        self.assertEqual(result['priorReviewExposureCounts'], {'미열람': 1, '열람': 1})
        row = result['caseSummary']['D01-followup']
        self.assertEqual(row['unexposedReportedDecisions'], 1)
        self.assertEqual(row['decisionCounts'], {'통과': 1, '실패': 1})
        self.assertTrue(row['differentDecisions'] and row['differentRequiredBehavior'] and row['differentCriticalViolation'])
        self.assertEqual(row['differentScores'], ['근거'])
        unexposed = result['unexposedCaseSummary']['D01-followup']
        self.assertEqual(unexposed['decisionCounts'], {'통과': 1})
        self.assertFalse(unexposed['differentDecisions'])
        self.assertFalse(unexposed['differentRequiredBehavior'])
        self.assertFalse(unexposed['differentCriticalViolation'])
        self.assertEqual(unexposed['differentScores'], [])

    def test_unexposed_disagreement_preserves_critical_and_score_differences(self):
        first = fixture_reply(self.answers, '검수 A', '미열람')
        second = fixture_reply(self.answers, '검수 B', '미열람', {'D01-followup': {
            '근거': '1', '중대 위반': '있음', '판정': '실패',
        }})
        third = fixture_reply(self.answers, '검수 C', '열람', {'D01-followup': {
            '요청 반영': '0', '필수 행동': '미충족', '판정': '수정',
        }})
        result = self.review(first, second, third)
        overall = result['caseSummary']['D01-followup']
        unexposed = result['unexposedCaseSummary']['D01-followup']
        self.assertEqual(overall['decisionCounts'], {'통과': 1, '실패': 1, '수정': 1})
        self.assertTrue(overall['differentRequiredBehavior'])
        self.assertEqual(overall['differentScores'], ['근거', '요청 반영'])
        self.assertEqual(unexposed['decisionCounts'], {'통과': 1, '실패': 1})
        self.assertTrue(unexposed['differentDecisions'])
        self.assertFalse(unexposed['differentRequiredBehavior'])
        self.assertTrue(unexposed['differentCriticalViolation'])
        self.assertEqual(unexposed['differentScores'], ['근거'])

    def test_unexposed_summary_counts_valid_holds_and_omits_unusable_rows(self):
        hold = fixture_reply(self.answers, '보류 검수', '미열람', {'B01': {
            '근거': '', '명료성': '', '필수 행동': '', '중대 위반': '', '판정': '보류',
            '판단 문장과 근거': '→ 출처 목록의 누락 여부 확인 필요',
        }})
        missing_case = fixture_reply(self.answers, '사례 누락', '미열람', omitted=('B01',))
        duplicate = fixture_reply(self.answers, 'Duplicate', '미열람')
        exposed_duplicate = fixture_reply(self.answers, 'duplicate', '열람')
        unknown = fixture_reply(self.answers, '열람 모름', '모름')
        missing = fixture_reply(self.answers, '열람 누락', '')
        invalid = fixture_reply(self.answers, '열람 오기', '확인')
        result = self.review(hold, missing_case, duplicate, exposed_duplicate, unknown, missing, invalid)
        self.assertEqual(result['priorReviewExposureCounts'], {'미열람': 3, '열람': 1, '모름': 1, '미기록': 2})
        overall = result['caseSummary']['B01']
        self.assertEqual(overall['recordableReplies'], 2)
        self.assertEqual(overall['decisionCounts'], {'통과': 1})
        unexposed = result['unexposedCaseSummary']['B01']
        self.assertEqual(unexposed['recordableReplies'], 1)
        self.assertEqual(unexposed['held'], 1)
        self.assertEqual(unexposed['decisionCounts'], {})
        self.assertFalse(unexposed['differentDecisions'])
        self.assertEqual(unexposed['differentScores'], [])

    def test_archive_binding_and_repeated_reviewers_are_not_counted(self):
        first = fixture_reply(self.answers, 'Reviewer A', '미열람')
        repeated = fixture_reply(self.answers, 'reviewer a', '열람')
        stale = fixture_reply(self.answers, '검수 C', '').replace(ANSWERS_SHA256, '0' * 64)
        result = self.review(first, repeated, stale)
        self.assertEqual(result['priorReviewExposureCounts']['미기록'], 1)
        self.assertEqual(result['caseSummary']['D01-first']['recordableReplies'], 0)
        for reply in result['replies'][:2]:
            self.assertIn({'field': REVIEWER, 'issue': 'duplicate-reviewer'}, reply['issues'])
        self.assertIn({'field': ANSWER_HASH, 'issue': 'archive-hash-missing-or-different'}, result['replies'][2]['issues'])

    def test_duplicate_rows_unknown_rows_and_blank_official_template(self):
        fixture = fixture_reply(self.answers, '검수 A', '미열람')
        last = fixture.splitlines()[-1]
        unexpected = last.replace('D03-no-context', 'unexpected-case')
        reply = self.review(fixture + '\n' + last + '\n' + unexpected)['replies'][0]
        self.assertTrue(any(issue['issue'] == 'unknown-case' for issue in reply['issues']))
        self.assertEqual(reply['cases']['D03-no-context']['issues'], ['duplicate-case'])

        template = Path(__file__).resolve().parents[2] / 'docs/review/docent-2026-11-15/README.md'
        result = self.review(template.read_text(encoding='utf-8'))
        self.assertEqual(len(result['replies'][0]['cases']), 12)
        self.assertTrue(all('decision-required' in row['issues'] for row in result['replies'][0]['cases'].values()))
        self.assertTrue(all(row['recordableReplies'] == 0 for row in result['caseSummary'].values()))
        self.assertTrue(all(row['recordableReplies'] == 0 for row in result['unexposedCaseSummary'].values()))


if __name__ == '__main__':
    unittest.main()
