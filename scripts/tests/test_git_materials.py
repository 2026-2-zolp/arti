import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from scripts.git_materials import ROOT, audit, captures
from scripts.export_git_captures import export


class GitMaterialTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'repo';self.root.mkdir()
        shutil.copytree(ROOT/'data/reference/git-captures',self.root/'data/reference/git-captures')
        provenance=json.loads((self.root/'data/reference/git-captures/provenance.json').read_text(encoding='utf-8'))
        for asset in provenance['assets']:
            dst=self.root/asset['path'];dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/asset['path'],dst)

    def edit_json(self,relative,change):
        path=self.root/relative;data=json.loads(path.read_text(encoding='utf-8'));change(data)
        path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')

    def test_reference_is_exact_pinned_git_blob(self):
        p=json.loads((self.root/'data/reference/git-captures/provenance.json').read_text(encoding='utf-8'))
        self.assertEqual(p['sourceCommit'],'ae0e58ebc338c17da6d4d17616fd802f03ba3bb6')
        self.assertEqual(p['sourcePath'],'backend/scripts/capture-descriptions.json')
        raw=subprocess.check_output(['git','show',p['sourceCommit']+':'+p['sourcePath']],cwd=ROOT)
        self.assertEqual(raw,(self.root/p['referenceFile']).read_bytes())
        self.assertEqual(hashlib.sha256(raw).hexdigest(),p['referenceSha256'])

    def test_export_needs_no_legacy_directory_or_node(self):
        self.assertFalse((self.root/'backend').exists())
        before={p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        report=audit(self.root);target=Path(self.temp.name)/'bundle';result=export(target,self.root)
        self.assertEqual(report['wikiArtImageFiles'],79);self.assertEqual(report['exampleEmotionCases'],11)
        self.assertEqual(report['pathCorrections'],40);self.assertIsNone(result['checkedAt'])
        self.assertEqual(len(result['items']),40)
        for row in result['items']:self.assertEqual(hashlib.sha256((target/row['file']).read_bytes()).hexdigest(),row['sha256'])
        self.assertEqual(before,{p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        with self.assertRaises(FileExistsError):export(target,self.root)

    def test_missing_or_changed_assets_and_reference_fail(self):
        path=self.root/'ai-service/evaluation/images/01.jpg';original=path.read_bytes()
        path.unlink()
        with self.assertRaises(ValueError):audit(self.root)
        path.write_bytes(b'changed')
        with self.assertRaises(ValueError):audit(self.root)
        path.write_bytes(original)
        (self.root/'data/reference/git-captures/capture-descriptions.json').write_bytes(b'{}')
        with self.assertRaises(ValueError):audit(self.root)

    def test_duplicate_missing_and_invalid_labels_fail(self):
        relative='ai-service/evaluation/tag_eval_set.json';path=self.root/relative;original=path.read_bytes()
        changes=[lambda d:d['items'].__setitem__(1,d['items'][0]),lambda d:d['items'].pop(),
                 lambda d:d['items'][0].update(expected=['unknown']),lambda d:d['items'][0].update(primary='unknown')]
        for change in changes:
            path.write_bytes(original);self.edit_json(relative,change)
            with self.assertRaises(ValueError):captures(self.root)

    def test_empty_draft_missing_source_and_extra_id_fail(self):
        relative='data/reference/git-captures/capture-descriptions.json';path=self.root/relative;original=path.read_bytes()
        for change in [lambda d:d['items']['01'].update(text=' '),lambda d:d['items']['01'].update(url=''),lambda d:d['items'].update(extra={})]:
            path.write_bytes(original);self.edit_json(relative,change)
            with self.assertRaises(ValueError):captures(self.root)

    def test_ambiguous_fallback_escape_and_declared_priority(self):
        image=self.root/'ai-service/evaluation/images/01.jpeg';image.write_bytes(b'new')
        with self.assertRaises(ValueError):captures(self.root)
        self.edit_json('ai-service/evaluation/tag_eval_set.json',lambda d:d['items'][0].update(imagePath='images/01.jpg'))
        self.assertFalse(captures(self.root)[3][0]['pathCorrected'])
        self.edit_json('ai-service/evaluation/tag_eval_set.json',lambda d:d['items'][0].update(imagePath='../../escape.png'))
        with self.assertRaises(ValueError):captures(self.root)
        with self.assertRaises(ValueError):audit(self.root)

    def test_source_and_existing_destination_rejected(self):
        for target in [self.root,self.root/'backend/new',self.root/'ai-service/new',self.root/'data/reference/new']:
            with self.assertRaises(ValueError):export(target,self.root)


if __name__=='__main__':unittest.main()
