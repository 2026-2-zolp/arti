"""Record reviewed source and image identity without reading credentials."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[4]


def cmd(args):
    return subprocess.check_output(args,cwd=REPO,text=True,encoding='utf-8',errors='replace').strip()


reviewed=json.loads((ROOT/'source-state.json').read_text(encoding='utf-8'))
names={item['path'] for item in reviewed['sources']}
sources=[]
for name in sorted(names):
    path=REPO/name
    if path.is_file():
        assert not name.startswith('.env') or name.endswith('.example'), name
        sources.append({'path':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
compose=['docker','compose','--env-file','.env.compose','-p','arti-w04']
versions=json.loads(cmd(compose+['exec','-T','api','python','-c',
    "import sys,json,importlib.metadata as m; print(json.dumps({'python':sys.version,'Django':m.version('Django'),'DRF':m.version('djangorestframework'),'psycopg':m.version('psycopg'),'gunicorn':m.version('gunicorn')}))"]))
result={'baseline':reviewed['baseline'],'observedHead':cmd(['git','rev-parse','HEAD']),'branch':cmd(['git','branch','--show-current']),
        'scope':'Local uncommitted W04 product changes; no remote push or real data import.',
        'sources':sources,'versions':versions,'node':cmd(compose+['exec','-T','frontend','node','--version']),
        'ignoredSettings':cmd(['git','check-ignore','.env.compose']),
        'apiImage':cmd(['docker','inspect','--format','{{.Image}}','arti-w04-api-1']),
        'frontendImage':cmd(['docker','inspect','--format','{{.Image}}','arti-w04-frontend-1']),
        'postgresImage':cmd(['docker','inspect','--format','{{.Image}}','arti-w04-db-1'])}
(ROOT/'source-state-current.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'tracked-diff-current.patch').write_text(cmd(['git','diff','--no-ext-diff',reviewed['baseline'],'--','backend-django','frontend','compose.yaml','scripts/init_dev_env.py','.env.compose.example'])+'\n',encoding='utf-8')
print(json.dumps({'files':len(sources),'versions':versions,'ignoredSettings':result['ignoredSettings']},ensure_ascii=False))
