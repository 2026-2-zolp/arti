# 미검수 자료를 성공으로 오인하지 않도록 준비 자료의 변조·승인 오표시를 검증합니다.
import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from yoo_readiness import read_inputs,check,verify

class YooReadinessTests(unittest.TestCase):
    def test_current_frozen_packet(self):
        self.assertTrue(verify()['ok'])

    def test_missing_duplicate_and_invalid_positions_rejected(self):
        for mutation in ['missing','duplicate','overlap','outside']:
            with self.subTest(mutation=mutation):
                inputs=read_inputs();items=inputs['layout-draft.json']['items']
                if mutation=='missing':items.pop()
                if mutation=='duplicate':items[-1]['id']=items[0]['id']
                if mutation=='overlap':items[-1].update(x=items[0]['x'],y=items[0]['y'])
                if mutation=='outside':items[0]['x']=101
                with self.assertRaises(ValueError):check(inputs)

    def test_pool_mismatch_and_claimed_live_readiness_rejected(self):
        for mutation in ['order','pair','live','physical']:
            with self.subTest(mutation=mutation):
                inputs=read_inputs()
                if mutation=='order':inputs['pool-decision.json']['selectedIds'].reverse()
                if mutation=='pair':inputs['pool-decision.json']['pairs'][0]['leftId']='yyk-demo-016'
                if mutation=='live':inputs['pool-decision.json']['readyNow']=True
                if mutation=='physical':inputs['layout-draft.json']['physicalRouteClaim']=True
                with self.assertRaises(ValueError):check(inputs)

    def test_fake_approval_and_labels_rejected(self):
        for mutation in ['approval','label','authority','guide']:
            with self.subTest(mutation=mutation):
                inputs=read_inputs();row=inputs['evaluation-plan.json']['items'][0]
                if mutation=='approval':inputs['human-review-checklist.json']['items'][0]['status']='approved'
                if mutation=='label':row['tagHypotheses']=['imaginary']
                if mutation=='authority':row['tagLabelAuthority']='verified truth'
                if mutation=='guide':row['guideCandidate']['hints']=[]
                with self.assertRaises(ValueError):check(inputs)
