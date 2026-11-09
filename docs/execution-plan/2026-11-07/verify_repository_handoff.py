"""Verify the retrospective commit handoff without network access or application mutations."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
errors=[]


def git(*args, binary=False):
    value=subprocess.check_output(['git','-C',str(REPO),*args])
    return value if binary else value.decode('utf-8').strip()


baseline='ae0e58ebc338c17da6d4d17616fd802f03ba3bb6'
history_start='f0c55aa7288de048b37b5711ed98f8ebb314e645'
reviewed_commit='8f46c66ec8bac67b3ab4982d7457abe28667ceca'
expected_commits=['b41adb5','c2612cf','5d9cf5d','b1507cf','63fb575','8f46c66']
if subprocess.run(['git','-C',str(REPO),'merge-base','--is-ancestor',reviewed_commit,'HEAD'],capture_output=True).returncode:
    errors.append('Current history does not contain the reviewed W04 commit.')
if git('rev-parse','b41adb5^{tree}')!=git('rev-parse',baseline+'^{tree}'):
    errors.append('Imported tree is not the original Dongsup integration tree.')
old='docs/1107_김동섭_(리팩토링전)프론트_백_통합.md'
new=REPO/'docs/작업기록/1107_김동섭_(리팩토링전)프론트_백_통합.md'
if new.read_bytes()!=git('show',baseline+':'+old,binary=True):
    errors.append('Dongsup handoff original bytes changed.')
snapshot=json.loads((ROOT/'records/W04/source-state.json').read_text(encoding='utf-8'))
for entry in snapshot['sources']:
    # Historical evidence is checked against its immutable commit, not a later W05 worktree.
    data=git('show',reviewed_commit+':'+entry['path'],binary=True)
    lf=data.replace(b'\r\n',b'\n')
    candidates={hashlib.sha256(x).hexdigest() for x in (data,lf,lf.replace(b'\n',b'\r\n'))}
    if entry['sha256'] not in candidates:
        errors.append('Reviewed product content differs: '+entry['path'])
    if '--verify-current-source' in sys.argv:
        current=(REPO/entry['path']).read_bytes().replace(b'\r\n',b'\n')
        if current!=lf:errors.append('Current source differs from W04: '+entry['path'])


def links(text):
    for match in re.finditer(r'!?\[[^\]]*\]\(',text):
        start=match.end()
        depth=1
        end=start
        while end<len(text) and depth:
            if text[end]=='(' and (end==0 or text[end-1]!='\\'):depth+=1
            if text[end]==')' and (end==0 or text[end-1]!='\\'):depth-=1
            end+=1
        if depth==0:yield text[start:end-1].strip().strip('<>')


files=[REPO/'README.md',REPO/'docs/README.md',REPO/'docs/통합준비문서.md',*(REPO/'docs/작업기록').glob('*.md'),*ROOT.rglob('*.md')]
link_count=0
for file in files:
    for target in links(file.read_text(encoding='utf-8')):
        if re.match(r'^(?:https?://|#|mailto:|[A-Za-z]:/)',target):continue
        target=unquote(target.split('#')[0]).replace('\\(','(').replace('\\)',')')
        if not (file.parent/target).exists():errors.append(str(file.relative_to(REPO))+': missing '+target)
        link_count+=1
tracked=git('ls-files','-z').split('\0')
for name in tracked:
    if name.endswith('.env.compose') or '/.venv/' in name or '/node_modules/' in name or 'pytest-temp' in name:
        errors.append('Local-only content tracked: '+name)
if git('branch','--show-current')!='dev/임준억':errors.append('Wrong development branch.')
if '--require-clean' in sys.argv and git('status','--porcelain'):
    errors.append('Worktree is not clean.')
commits=git('log','--first-parent','--reverse','--format=%h %s',history_start+'..'+reviewed_commit).splitlines()
if [row.split()[0] for row in commits]!=expected_commits:
    errors.append('Original import/plan/W01–W04 commit sequence differs.')
result={'ok':not errors,'branch':git('branch','--show-current'),'reviewedProductFiles':len(snapshot['sources']),
        'reviewedSourceCommit':reviewed_commit,'currentSourceChecked':'--verify-current-source' in sys.argv,
        'checkedLocalLinks':link_count,'firstParentCommits':commits,'errors':errors,
        'scope':'Git/document/evidence handoff only; no new model/cloud acceptance.'}
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(0 if result['ok'] else 1)
