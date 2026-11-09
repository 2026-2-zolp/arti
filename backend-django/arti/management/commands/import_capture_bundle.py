# 기존 Git 캡처40점 묶음을 미검수 상태로 명시적으로 인수합니다.
import hashlib
import json
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from arti.models import Artwork, Exhibition


class Command(BaseCommand):
    help='Explicitly import a Git 40-work capture bundle as draft/source_check; never auto approve or overwrite.'

    def add_arguments(self,parser):
        parser.add_argument('directory',type=Path)
        parser.add_argument('--dry-run',action='store_true')

    def handle(self,*args,**options):
        root=options['directory'].resolve()
        manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
        rows=manifest.get('items',[])
        if manifest.get('version')!=1 or manifest.get('exhibitionId')!='ex-capture' or len(rows)!=40 or len({r['id'] for r in rows})!=40:
            raise CommandError('Expected the versioned 40-work capture bundle.')
        for row in rows:
            file=root/row['file']
            if not row['id'].startswith('cap-') or file.resolve().parent!=root or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=row['sha256']:
                raise CommandError('Missing/changed/unsafe file: '+row['id'])
        if Exhibition.objects.filter(pk='ex-capture').exists() or Artwork.objects.filter(pk__in=[r['id'] for r in rows]).exists():
            raise CommandError('Target exists; preserve it and compare/export manually. No overwrite/reset supported.')
        if options['dry_run']:
            self.stdout.write(json.dumps({'ok':True,'dryRun':True,'works':40,'imagesVerified':40,'reviewStatus':'source_check','exhibitionStatus':'draft'}));return
        created=[]
        try:
            with transaction.atomic():
                ex=Exhibition(id='ex-capture',title=manifest['title'],subtitle=manifest['source'],venue='팀 내부 자료 검수용',
                    start_date='2026-10-01',end_date='2026-12-31',status='draft',rooms=[])
                ex.full_clean();ex.save()
                settings.MEDIA_ROOT.mkdir(parents=True,exist_ok=True)
                for row in rows:
                    target=settings.MEDIA_ROOT/row['file']
                    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=row['sha256']:raise CommandError('Media collision.')
                    if not target.exists():target.write_bytes((root/row['file']).read_bytes());created.append(target)
                    w=Artwork(id=row['id'],exhibition=ex,title=row['title'],artist=row['artist'],year=row['year'],
                        description=row['description'],reference_url=row['referenceUrl'],source=manifest['source'],
                        image_file=row['file'],review_status='source_check',tags=[],position_x=None,position_y=None)
                    w.full_clean();w.save()
        except Exception:
            for target in created:target.unlink(missing_ok=True)
            raise
        self.stdout.write(json.dumps({'ok':True,'imported':40,'publicWorks':0,'imagesVerified':40,'accountsImported':0,
                                     'localDbUniqueData':'unknown; separate handoff required'}))
