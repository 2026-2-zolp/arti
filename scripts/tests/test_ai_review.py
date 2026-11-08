# 숫자 표시가 정답 확률·무응답 부정·자동 승인으로 변하는 회귀를 방지합니다.
import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ai_review import vote_summary, model_score, check_contract, RECORD


class ReviewTests(unittest.TestCase):
    def test_unknown_and_nonresponse_are_distinct(self):
        v=vote_summary(3,1,unknown=1,exposed=10)
        self.assertEqual(v['positivePercent'],75)
        self.assertEqual(v['responsePercent'],50)
        self.assertEqual(v['unknown'],1)

    def test_zero_and_small_samples_do_not_imply_certainty(self):
        self.assertIsNone(vote_summary(0,0)['positivePercent'])
        self.assertIsNone(vote_summary(2,0,public_helpfulness=True)['positivePercent'])
        self.assertEqual(vote_summary(8,2,public_helpfulness=True)['positivePercent'],80)

    def test_impossible_counts_rejected(self):
        for args in [(True,1,0,None),(-1,0,0,None),(5,1,0,2)]:
            with self.assertRaises(ValueError):vote_summary(*args)

    def test_scores_cannot_be_percent_probabilities(self):
        self.assertEqual(model_score(.74)['unit'],'score')
        self.assertFalse(model_score(.74)['isProbability'])
        for v in [float('nan'),float('inf'),True,74,-.1]:
            with self.assertRaises(ValueError):model_score(v)

    def test_mutated_contract_cannot_auto_learn_or_drop_versions(self):
        c=json.loads((RECORD/'presentation-contract.json').read_text(encoding='utf-8'))
        for field in ['autoTrain','autoApprove']:
            bad=copy.deepcopy(c);bad['feedback'][field]=True
            with self.assertRaises(ValueError):check_contract(bad)
        bad=copy.deepcopy(c);bad['feedback']['required'].remove('targetRevision')
        with self.assertRaises(ValueError):check_contract(bad)
