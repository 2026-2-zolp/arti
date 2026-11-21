"""Apply the reviewed floor layout without importing exhibition or artwork content."""

from hashlib import sha256
import json
from pathlib import Path
import struct

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from arti.indoor import normalize_layout
from arti.models import Artwork, Exhibition, validate_point
from arti.views import public_works


MANIFEST = Path(__file__).resolve().parents[2] / 'data' / 'spain_designmuseum.json'
MAP_FIELDS = ('rooms', 'entrance_x', 'entrance_y', 'floor_plan', 'floor_plan_revision', 'navigation_layout')
POSITION_FIELDS = ('room_id', 'position_x', 'position_y')


class Command(BaseCommand):
    help = 'Check or install the reviewed Design Museum layout for the Spain exhibition.'

    def add_arguments(self, parser):
        parser.add_argument('--image', type=Path, required=True)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-version', type=int)
        parser.add_argument('--backup', type=Path)

    def handle(self, *args, **options):
        manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
        plan = manifest['floorPlan']
        image = options['image'].read_bytes()
        if (sha256(image).hexdigest() != plan['sha256'] or image[:8] != b'\x89PNG\r\n\x1a\n'
                or struct.unpack('!II', image[16:24]) != (plan['width'], plan['height'])):
            raise CommandError('The floor plan image does not match the reviewed file.')
        filename = plan['sha256'][:48] + '.png'
        expected_order = [work['id'] for work in manifest['works']]
        placements = {work['id']: (work['roomId'], work['position']['x'], work['position']['y'])
                      for work in manifest['works']}
        if len(placements) != len(expected_order):
            raise CommandError('Duplicate artwork in the map manifest.')

        with transaction.atomic():
            ex = Exhibition.objects.select_for_update().filter(pk=manifest['exhibitionId'], status='running').first()
            if ex is None:
                raise CommandError('The Spain exhibition must be running.')
            works = list(Artwork.objects.select_for_update().filter(exhibition=ex).order_by('pk'))
            public = set(public_works(ex.pk).values_list('pk', flat=True))
            if public != set(expected_order) or [pk for pk in ex.direct_visit_order if pk in public] != expected_order:
                raise CommandError('The published artworks or exhibition order changed. Review the map again.')
            fields = {
                'rooms': manifest['rooms'], 'entrance_x': manifest['entrance']['x'], 'entrance_y': manifest['entrance']['y'],
                'floor_plan': {'file': filename, 'width': plan['width'], 'height': plan['height']},
            }
            revision = ex.floor_plan_revision + (ex.floor_plan != fields['floor_plan'])
            fields['floor_plan_revision'] = revision
            fields['navigation_layout'] = normalize_layout(manifest['layout'], revision)
            room_ids = {room['id'] for room in fields['rooms']}
            changed = []
            for work in works:
                target = placements.get(work.pk, ('', None, None))
                validate_point(target[1], target[2])
                if target[0] and target[0] not in room_ids:
                    raise CommandError('A placement references an unregistered room.')
                if tuple(getattr(work, field) for field in POSITION_FIELDS) != target:
                    changed.append((work, target))
            media = settings.MEDIA_ROOT / filename
            same_map = all(getattr(ex, field) == value for field, value in fields.items())
            result = {'exhibitionId': ex.pk, 'exhibitionVersion': ex.version, 'floorPlanRevision': revision,
                      'publicArtworks': len(public), 'changedPositions': len(changed), 'applied': False}
            if not options['apply']:
                self.stdout.write(json.dumps(result))
                return
            if same_map and not changed and media.is_file() and sha256(media.read_bytes()).hexdigest() == plan['sha256']:
                self.stdout.write(json.dumps({**result, 'alreadyApplied': True}))
                return
            if options['expected_version'] != ex.version or options['backup'] is None:
                raise CommandError('Supply the checked exhibition version and a new backup path.')
            snapshot = {'exhibition': {field: getattr(ex, field) for field in (*MAP_FIELDS, 'version')},
                        'works': {work.pk: {field: getattr(work, field) for field in (*POSITION_FIELDS, 'version', 'content_version')}
                                  for work, _ in changed}}
            with options['backup'].open('x', encoding='utf-8') as backup:
                json.dump(snapshot, backup, ensure_ascii=False)
            try:
                with media.open('xb') as destination:
                    destination.write(image)
            except FileExistsError:
                if sha256(media.read_bytes()).hexdigest() != plan['sha256']:
                    raise CommandError('The existing floor plan media differs from the approved file.') from None
            for field, value in fields.items():
                setattr(ex, field, value)
            ex.version += 1
            ex.full_clean()
            ex.save(update_fields=[*MAP_FIELDS, 'version', 'updated_at'])
            for work, target in changed:
                work.room_id, work.position_x, work.position_y = target
                work.version += 1
                work.content_version += 1
                work.save(update_fields=[*POSITION_FIELDS, 'version', 'content_version', 'updated_at'])
            result.update(exhibitionVersion=ex.version, applied=True)
        self.stdout.write(json.dumps(result))
