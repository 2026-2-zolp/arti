# 운영자가 검수된 작품 10점의 순서·버전을 지정해 조사풀을 설정합니다.
import json
import re
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction
from arti.models import Artwork, SurveyEntry, SurveyPool
from arti.survey import eligible


class Command(BaseCommand):
    help = 'Configure an explicitly curated survey; never approve/import artwork. Activation publishes survey images.'

    def add_arguments(self, parser):
        parser.add_argument('--manifest', required=True)
        parser.add_argument('--expected-revision', type=int, required=True)
        parser.add_argument('--activate', action='store_true')

    def handle(self, *args, **options):
        try:
            data = json.loads(Path(options['manifest']).read_text(encoding='utf-8-sig'))
        except (OSError, ValueError) as exc:
            raise CommandError('Cannot read survey manifest.') from exc
        if not isinstance(data, dict) or set(data) != {'id', 'name', 'artworkIds'}:
            raise CommandError('Expected id, name, artworkIds only.')
        if (not isinstance(data['id'], str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', data['id'])
                or not isinstance(data['name'], str) or '\x00' in data['name'] or not 1 <= len(data['name'].strip()) <= 100):
            raise CommandError('Invalid survey ID/name.')
        ids = data['artworkIds']
        if (not isinstance(ids, list) or len(ids) != 10
                or any(not isinstance(i, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', i) for i in ids) or len(set(ids)) != 10):
            raise CommandError('Exactly 10 unique ordered artwork IDs required.')
        try:
            with transaction.atomic():
                # 모든 풀 편집을 같은 잠금 순서로 직렬화하고 활성 교체는 한 트랜잭션에서 수행합니다.
                list(SurveyPool.objects.select_for_update().order_by('id'))
                pool = SurveyPool.objects.filter(pk=data['id']).first()
                if options['expected_revision'] != (pool.revision if pool else 0):
                    raise CommandError('Survey revision conflict; reload before configuring.')
                works = {w.id: w for w in Artwork.objects.select_for_update().filter(pk__in=ids).order_by('id')}
                if len(works) != 10 or any(not eligible(works[i]) for i in ids):
                    raise CommandError('All 10 artworks require approved source, confirmed tags and a visible image.')
                if pool is None:
                    pool = SurveyPool(id=data['id'], revision=1)
                else:
                    pool.revision += 1
                pool.name = data['name'].strip()
                # --activate가 없으면 초안으로 저장하고 이 풀의 기존 조사를 비활성화합니다.
                pool.active = False
                pool.save()
                pool.entries.all().delete()
                SurveyEntry.objects.bulk_create([SurveyEntry(pool=pool, artwork=works[pk], position=i) for i, pk in enumerate(ids)])
                if options['activate']:
                    SurveyPool.objects.filter(active=True).update(active=False)
                    pool.active = True
                    pool.save(update_fields=['active'])
        except IntegrityError as exc:
            raise CommandError('Concurrent survey configuration conflict; retry with current revision.') from exc
        self.stdout.write(f'Survey {pool.id}: revision={pool.revision}, active={pool.active}, artworks=10')
