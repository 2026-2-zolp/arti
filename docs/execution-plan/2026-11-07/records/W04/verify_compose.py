"""Exercise the isolated arti-w04 dev project. No volume deletion or real-data import."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
COMPOSE = ['docker', 'compose', '--env-file', '.env.compose', '-p', 'arti-w04']
events = []


def run(args, *, code=0, stdin=None):
    result = subprocess.run(COMPOSE+args, cwd=REPO, input=stdin, capture_output=True, text=True, encoding='utf-8', errors='replace')
    events.append({'command': 'docker compose [ignored env] -p arti-w04 '+' '.join(args),
                   'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    if result.returncode != code:
        raise RuntimeError(f'Unexpected exit {result.returncode}: {args}')
    return result.stdout


STATE = '''
import os, json, hashlib
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django; django.setup()
from django.conf import settings
from django.db import connection
from arti.models import Account,Artwork,Exhibition
with connection.cursor() as c:
 c.execute('SELECT version()'); version=c.fetchone()[0]
marker=settings.MEDIA_ROOT/'w04-persistence-marker.bin'
print(json.dumps({'exhibitions':Exhibition.objects.count(),'artworks':Artwork.objects.count(),
 'accounts':Account.objects.count(),'markerVersion':Exhibition.objects.get(pk='fixture-ex01').version,
 'fileSha256':hashlib.sha256(marker.read_bytes()).hexdigest(), 'postgresVersion':version}))
'''
try:
    run(['exec','-T','api','python','-'],stdin='''
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django; django.setup()
from django.conf import settings
from arti.models import Exhibition
Exhibition.objects.filter(pk='fixture-ex01').update(version=7)
(settings.MEDIA_ROOT/'w04-persistence-marker.bin').write_bytes(b'W04 persistence sentinel; no user data')
''')
    before = json.loads(run(['exec','-T','api','python','-'],stdin=STATE))
    before_ids = run(['ps','-q','db','api']).splitlines()
    run(['up','-d','--force-recreate','db','api'])
    # Compose api healthcheck is the same ready contract being exercised.
    run(['up','-d','--wait','api'])
    after = json.loads(run(['exec','-T','api','python','-'],stdin=STATE))
    after_ids = run(['ps','-q','db','api']).splitlines()
    assert before == after, (before, after)
    assert set(before_ids).isdisjoint(after_ids), 'Containers were not recreated.'
    run(['exec','-T','-e','ARTI_ENV=production','-e','ALLOW_TEST_FIXTURES=true','api','python','manage.py','load_test_fixture'],code=1)
    run(['exec','-T','api','python','manage.py','check'])
    run(['exec','-T','api','python','manage.py','makemigrations','--check','--dry-run'])
    result = {'ok': True, 'before': before, 'after': after, 'containersRecreated': True,
              'productionFixtureRejected': True, 'scope': 'Local W04 Compose/Postgres/file persistence only; not AWS backup/restore.'}
except Exception as error:
    result = {'ok': False, 'error': str(error)}
finally:
    (ROOT/'compose-events-current.json').write_text(json.dumps(events,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'compose-check-current.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(0 if result['ok'] else 1)
