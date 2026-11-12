# 허용된 개발·시험 환경에만 합성 전시 자료를 적재합니다.
import base64
import json
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from arti.models import Artwork, Exhibition, SurveyPool, SurveyEntry

FIXTURE_SOURCE = 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V0AAAAASUVORK5CYII=')


class Command(BaseCommand):
    help = 'Load only the bundled synthetic development fixture; no accounts, no real artwork import.'

    @transaction.atomic
    def handle(self, *args, **options):
        if settings.ARTI_ENV not in ('development', 'test') or not settings.ALLOW_TEST_FIXTURES:
            raise CommandError('Test fixtures require development/test AND ALLOW_TEST_FIXTURES=true.')
        data = json.loads((settings.BASE_DIR/'development_fixture.json').read_text(encoding='utf-8'))
        list(SurveyPool.objects.select_for_update().order_by('id'))
        for ex in data['exhibitions']:
            pk = ex.pop('id')
            if not pk.startswith('fixture-'):
                raise CommandError('Fixture IDs must use fixture- prefix.')
            previous = Exhibition.objects.filter(pk=pk).first()
            if previous and previous.subtitle != FIXTURE_SOURCE:
                raise CommandError('Refusing to overwrite an exhibition not owned by this fixture.')
            obj = previous or Exhibition(id=pk)
            for key, value in ex.items():
                setattr(obj, key, value)
            obj.full_clean()
            Exhibition.objects.update_or_create(pk=pk, defaults=ex)
        for fields in data['artworks']:
            pk = fields.pop('id')
            previous = Artwork.objects.filter(pk=pk).first()
            if not pk.startswith('fixture-') or (previous and previous.source != FIXTURE_SOURCE):
                raise CommandError('Refusing to overwrite artwork outside this fixture.')
            obj = previous or Artwork(id=pk)
            for key, value in fields.items():
                setattr(obj, key, value)
            obj.full_clean()
            Artwork.objects.update_or_create(pk=pk, defaults=fields)
        # 합성 환경에서만 명시적 10점 조사풀을 구성합니다. 실제 풀을 덮어쓰지 않습니다.
        pool, created = SurveyPool.objects.get_or_create(id='fixture-survey', defaults={'name': FIXTURE_SOURCE})
        if pool.name != FIXTURE_SOURCE:
            raise CommandError('Refusing to overwrite a survey not owned by this fixture.')
        other_active = SurveyPool.objects.filter(active=True).exclude(pk=pool.id).exists()
        if not other_active:
            if not created:
                pool.revision += 1
            pool.active = True
            pool.save()
            pool.entries.all().delete()
            SurveyEntry.objects.bulk_create([SurveyEntry(pool=pool, artwork_id=f'fixture-art{i+1:02}', position=i) for i in range(10)])
        settings.MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        (settings.MEDIA_ROOT/'fixture-public.png').write_bytes(PNG)
        (settings.MEDIA_ROOT/'fixture-private.png').write_bytes(PNG)
        self.stdout.write(f"Synthetic fixture loaded: {len(data['exhibitions'])} exhibitions, {len(data['artworks'])} artworks, 0 accounts.")
