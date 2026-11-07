"""Pinned local source inventory; no service execution or credentials."""
import hashlib, json, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
SHA = 'ae0e58ebc338c17da6d4d17616fd802f03ba3bb6'
head = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip()
assert subprocess.run(['git','-C',str(REPO),'merge-base','--is-ancestor',SHA,'HEAD']).returncode == 0
head = SHA
clean = subprocess.run(['git', '-C', str(REPO), 'diff', '--quiet', SHA, '--', 'frontend/src', 'backend/src'])
if clean.returncode != 0:
    raise SystemExit('Source worktree has changed since G1. Preserve this baseline inventory; capture later work in its own stage.')
files = sorted({*list((REPO/'frontend/src').rglob('*.ts')), *list((REPO/'frontend/src').rglob('*.tsx')),
                *list((REPO/'backend/src').rglob('*.ts'))})
sources, routes, calls = [], [], []
for path in files:
    body = path.read_text(encoding='utf-8')
    relative = path.relative_to(REPO).as_posix()
    sources.append({'path':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    for n,line in enumerate(body.splitlines(),1):
        match = re.search(r"\b(?:r|app)\.(get|post|put|delete)\(['\"]([^'\"]+)",line)
        if match:
            route = match[2] if relative.endswith('/app.ts') else '/api'+match[2]
            routes.append({'method':match[1].upper(),'path':route,'source':relative,'line':n})
        if relative.startswith('frontend/'):
            for name in re.findall(r'\bapi\.(\w+)\(',line):
                calls.append({'method':name,'source':relative,'line':n})
out = {'baseline':head,'scope':'Static route registrations and direct api calls; not runtime coverage',
       'sources':sources,'routes':routes,'calls':calls,
       'uploadMount':'/api/uploads (app.use, outside authentication in baseline)'}
(ROOT/'source-inventory.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines=['# 実코드 경로·호출 인벤토리'.replace('実','실'),'',f'기준 SHA: {head}',
       '', 'audit_source.py로 재생성. 정적 등록/직접 호출 목록이며 실제 HTTP·브라우저 통과 증거가 아니다.',
       '', '| Method | 현재 경로 | 실제 소스:행 |','| --- | --- | --- |']
lines += [f"| {r['method']} | {r['path']} | {r['source']}:{r['line']} |" for r in routes]
lines += ['', '업로드 mount: /api/uploads. 기준 코드에서는 인증 미들웨어 밖의 static 제공이다.',
          '', '| client 함수 | 호출 소스:행 |','| --- | --- |']
lines += [f"| {r['method']} | {r['source']}:{r['line']} |" for r in calls]
(ROOT/'source-inventory.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'head':head,'sources':len(sources),'routes':len(routes),'calls':len(calls)}))
