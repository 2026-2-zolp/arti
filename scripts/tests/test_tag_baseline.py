# 결측·동점 처리와 지표 오해를 합성 예시로 검증합니다.
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tag_baseline import TAG_KEYS, metrics, consensus, report


def pred(*tags):return {k:k in tags for k in TAG_KEYS}


class BaselineTests(unittest.TestCase):
    def test_hand_computed_precision_recall_f1(self):
        value=metrics([pred('people'),pred('people'),pred()], [{'people'},set(),{'people'}])
        self.assertEqual(value['perTag']['people']['precision'],.5)
        self.assertEqual(value['perTag']['people']['recall'],.5)
        self.assertEqual(value['microF1'],.5)

    def test_tie_is_not_negative(self):
        labels,masks,_=consensus([{'01':{'tags':{'people'}}},{'01':{'tags':set()}}],['01'])
        self.assertFalse(masks[0]['people'])
        value=metrics([pred('people')],labels,masks)
        self.assertEqual(value['perTag']['people']['cells'],0)
        self.assertIsNone(value['macroF1'])

    def test_unsupported_tag_not_perfect(self):
        value=metrics([pred()], [set()])
        self.assertIsNone(value['perTag']['people']['f1'])
        self.assertIsNone(value['perTag']['people']['recall'])
        self.assertIsNone(value['macroF1'])

    def test_primary_inclusion_not_top1_or_accuracy(self):
        items=[{'id':'01','primary':'people','expected':['people']}]
        raters={'a':{'01':{'tags':{'people'},'primary':'people'}}}
        raw={'01':{'scores':{k:.6 if k!='landscape' else .9 for k in TAG_KEYS}}}
        value=report(raw,items,raters,{k:.5 for k in TAG_KEYS})
        v=value['savedMajority']['all_positive_sanity']
        self.assertEqual(v['primaryInclusionRate'],1)
        self.assertEqual(v['scoreArgmaxPrimaryAccuracy'],0)
        self.assertLess(v['microF1'],.3)

    def test_mismatched_inputs_fail(self):
        with self.assertRaises(ValueError):metrics([pred()],[set(),set()])
        with self.assertRaises(ValueError):metrics([],[])
