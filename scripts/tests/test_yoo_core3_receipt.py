import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from yoo_core3_receipt import FIELDS, check_receipt, read_references


class Core3ReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hashes, cls.wording_hash = read_references()

    def receipt(self, number):
        record_id = f'yyk-intake-20261109-{number}'
        reviewer_details = {'reviewedOn': '2026-11-16', 'decision': 'confirmed', 'evidence': '합성 시험 근거'}
        return {
            'recordId': record_id,
            'imageSha256': self.hashes[record_id],
            'wordingSha256': self.wording_hash,
            'content': [dict(reviewer_details, field='question', judgedText='합성 질문', reviewer='시험 문안 검수자')],
            'usage': [dict(reviewer_details, medium='campus_demo', scope='합성 교내 접속 조건', reviewer='시험 사용 검수자')],
        }

    def check(self, receipt):
        return check_receipt(receipt, self.hashes, self.wording_hash)

    def test_matching_receipt_records_only_explicit_field_and_medium(self):
        for number in ('001', '004', '010'):
            with self.subTest(number=number):
                receipt = self.receipt(number)
                receipt['imageSha256'] = receipt['imageSha256'].upper()
                result = self.check(receipt)
                self.assertEqual(result['content']['question']['status'], 'recordable')
                self.assertEqual(result['content']['question']['reviewer'], '시험 문안 검수자')
                self.assertEqual(result['content']['hint']['issues'], ['no-entry'])
                self.assertEqual(result['usage']['campus_demo']['status'], 'recordable')
                self.assertEqual(result['usage']['campus_demo']['reviewer'], '시험 사용 검수자')
                for medium in ('presentation', 'recording', 'external_url'):
                    self.assertEqual(result['usage'][medium]['status'], 'pending')

    def test_missing_or_other_work_image_keeps_content_and_usage_pending(self):
        for issue in ('missing', 'mismatch'):
            with self.subTest(issue=issue):
                receipt = self.receipt('001')
                if issue == 'missing':
                    del receipt['imageSha256']
                else:
                    receipt['imageSha256'] = self.hashes['yyk-intake-20261109-004']
                result = self.check(receipt)
                for group, key in [('content', 'question'), ('usage', 'campus_demo')]:
                    self.assertEqual(result[group][key]['status'], 'pending')
                    self.assertEqual(result[group][key]['issues'], [f'imageSha256-{issue}'])

    def test_missing_or_different_wording_leaves_only_content_pending(self):
        for issue in ('missing', 'mismatch'):
            with self.subTest(issue=issue):
                receipt = self.receipt('004')
                if issue == 'missing':
                    del receipt['wordingSha256']
                else:
                    receipt['wordingSha256'] = '0' * 64
                result = self.check(receipt)
                self.assertEqual(result['content']['question']['issues'], [f'wordingSha256-{issue}'])
                self.assertEqual(result['usage']['campus_demo']['status'], 'recordable')

    def test_unspecified_medium_cannot_be_assigned_to_any_usage(self):
        receipt = self.receipt('010')
        del receipt['usage'][0]['medium']
        result = self.check(receipt)
        self.assertEqual(result['unassignedUsageEntries'], [1])
        self.assertTrue(all(row['status'] == 'pending' for row in result['usage'].values()))
        self.assertEqual(result['content']['question']['status'], 'recordable')

    def test_reviewer_hold_and_ambiguous_rows_stay_pending(self):
        receipt = self.receipt('010')
        receipt['content'][0]['decision'] = 'hold'
        receipt['usage'].append(dict(receipt['usage'][0], reviewer='추가 시험 사용 검수자'))
        result = self.check(receipt)
        question = result['content']['question']
        self.assertEqual(question['issues'], ['reviewer-hold'])
        self.assertEqual(question['reviewer'], '시험 문안 검수자')
        self.assertEqual(result['usage']['campus_demo']['issues'], ['multiple-entries'])
        self.assertEqual(result['usage']['campus_demo']['entries'], [1, 2])

    def test_edit_decision_keeps_original_decision_and_requires_reviewer(self):
        receipt = self.receipt('010')
        receipt['content'][0]['decision'] = 'revise'
        result = self.check(receipt)
        self.assertEqual(result['content']['question']['status'], 'recordable')
        self.assertEqual(result['content']['question']['decision'], 'revise')
        del receipt['content'][0]['reviewer']
        result = self.check(receipt)
        self.assertEqual(result['content']['question']['issues'], ['reviewer-missing'])

    def test_handoff_connects_all_confirmed_fields_to_only_the_confirmed_medium(self):
        receipt = self.receipt('001')
        receipt['content'] = [dict(receipt['content'][0], field=name) for name in FIELDS]
        result = self.check(receipt)['handoff']
        self.assertEqual(result['pendingContentFields'], [])
        self.assertEqual(result['media']['campus_demo'], {'usageConfirmed': True, 'status': 'ready-for-review'})
        for medium in ('presentation', 'recording', 'external_url'):
            self.assertEqual(result['media'][medium], {'usageConfirmed': False, 'status': 'pending'})

    def test_handoff_waits_for_missing_revise_or_superseded_wording(self):
        for issue in ('missing-hint', 'revise-hint', 'old-wording'):
            with self.subTest(issue=issue):
                receipt = self.receipt('004')
                receipt['content'] = [dict(receipt['content'][0], field=name) for name in FIELDS]
                if issue == 'missing-hint':
                    receipt['content'].pop()
                elif issue == 'revise-hint':
                    receipt['content'][-1]['decision'] = 'revise'
                else:
                    receipt['wordingSha256'] = '0' * 64
                result = self.check(receipt)['handoff']
                self.assertEqual(result['pendingContentFields'], list(FIELDS) if issue == 'old-wording' else ['hint'])
                self.assertEqual(result['media']['campus_demo'], {'usageConfirmed': True, 'status': 'pending'})
