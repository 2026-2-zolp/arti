# 미응답·불확실성·가짜 완료/승인·파일 대응 오류를 합성 응답으로 검증합니다.
import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from yoo_labels import MANIFEST,TAGS,validate


def draft():
    m=json.loads(MANIFEST.read_text(encoding='utf-8'))
    d=dict(format='arti-independent-labels',version=1,manifestDigest=m['digest'],tagDefinitionVersion=m['tagDefinitionVersion'],reviewerAlias='TEST',forTesting=True,createdAt='2026-11-09T00:00:00Z',sampleOrder=[r['id'] for r in m['items']],completeCount=0,status='draft',items=[dict(id=r['id'],imageSha256=r['sha256'],imageVerified=False,tags={k:None for k in TAGS},emotionReviewed=False,emotions=[]) for r in m['items']])
    return d,m


class LabelTests(unittest.TestCase):
    def test_unanswered_is_not_negative(self):
        d,m=draft();r=validate(d,m,True)
        self.assertEqual(r['unansweredTagCells'],128);self.assertEqual(r['validTagJudgments'],0)
        self.assertFalse(r['contentApproved'])

    def test_test_data_rejected_by_default(self):
        d,m=draft()
        with self.assertRaises(ValueError):validate(d,m)

    def test_uncertain_completed_response_is_not_ground_truth(self):
        d,m=draft()
        for row in d['items']:row.update(imageVerified=True,tags={k:'unsure' for k in TAGS})
        d.update(completeCount=16,status='submitted');r=validate(d,m,True)
        self.assertEqual(r['validTagJudgments'],0);self.assertEqual(r['uncertainTagAnswers'],128)
        self.assertFalse(r['teamReviewAccepted'])

    def test_hash_duplicate_and_fake_completion_fail(self):
        d,m=draft()
        for change in ['hash','duplicate','count','approved']:
            bad=copy.deepcopy(d)
            if change=='hash':bad['items'][0]['imageSha256']='0'*64
            if change=='duplicate':bad['items'][1]=copy.deepcopy(bad['items'][0])
            if change=='count':bad['completeCount']=16
            if change=='approved':bad['status']='approved'
            with self.subTest(change=change),self.assertRaises(ValueError):validate(bad,m,True)

    def test_boolean_label_and_unseen_image_fail(self):
        d,m=draft()
        for value in [True,'yes']:
            bad=copy.deepcopy(d);bad['items'][0]['tags']['vivid']=value
            with self.subTest(value=value),self.assertRaises(ValueError):validate(bad,m,True)

    def test_rehashed_manifest_cannot_replace_intake_identity(self):
        import hashlib
        d,m=draft();m['items'][0]['sha256']='0'*64
        original={k:v for k,v in m.items() if k!='digest'}
        m['digest']=hashlib.sha256(json.dumps(original,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        d['manifestDigest']=m['digest']
        with self.assertRaises(ValueError):validate(d,m,True)
