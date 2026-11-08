# 전시별 인수 manifest와 이미지를 검증하고 공개되지 않은 검수 제안으로만 적재합니다.
"""Explicit create-only intake; no approval, model inference, layout or account import."""
import hashlib
import json
import re
from datetime import date
from pathlib import Path
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from arti.models import Artwork, Exhibition

ID = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}')
FILE = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}\.(png|jpg|jpeg|webp)')
HEX = re.compile(r'[0-9a-f]{64}')
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024


def exact_fields(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise CommandError('Manifest fields do not match intake v1; approval/layout fields are not accepted.')


def text(value, maximum, allow_empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value.strip()) or '\x00' in value:
        raise CommandError('Invalid or missing intake text.')
    return value


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise CommandError('Invalid intake identifier.')
    return value


def local_image(root, row):
    # 평면 파일만 허용하고 심볼릭링크·변조·예상하지 않은 형식을 거절합니다.
    name = row['file']
    if not isinstance(name, str) or not FILE.fullmatch(name):
        raise CommandError('Unsafe image filename.')
    path = root / name
    if path.is_symlink() or path.resolve().parent != root or not path.is_file() or not 0 < path.stat().st_size <= MAX_IMAGE_BYTES:
        raise CommandError('Missing, linked or oversized image.')
    with path.open('rb') as image:
        raw = image.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise CommandError('Oversized image.')
    digest = row['sha256']
    if not isinstance(digest, str) or not HEX.fullmatch(digest) or hashlib.sha256(raw).hexdigest() != digest:
        raise CommandError('Image SHA256 mismatch.')
    valid = ((name.endswith('.png') and raw.startswith(b'\x89PNG\r\n\x1a\n')) or
             (name.endswith(('.jpg', '.jpeg')) and raw.startswith(b'\xff\xd8\xff')) or
             (name.endswith('.webp') and raw.startswith(b'RIFF') and raw[8:12] == b'WEBP'))
    if not valid:
        raise CommandError('Image signature and extension do not match.')
    return raw


def read_bundle(root, allow_http_reference=False):
    path = root / 'manifest.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise CommandError('Missing or oversized manifest.')
    raw = path.read_bytes()
    data = json.loads(raw)
    exact_fields(data, 'format version exhibition items')
    if data['format'] != 'arti-exhibition-intake' or type(data['version']) is not int or data['version'] != 1:
        raise CommandError('Expected arti-exhibition-intake version1.')
    ex = data['exhibition']
    exact_fields(ex, 'id title subtitle venue startDate endDate kind basis')
    identifier(ex['id'])
    for key, maximum in [('title', 100), ('subtitle', 200), ('venue', 100), ('basis', 1000)]:
        text(ex[key], maximum)
    if ex['kind'] != 'demo_reconstruction':
        raise CommandError('Intake v1 supports explicitly labelled demo reconstruction only.')
    if date.fromisoformat(ex['startDate']) > date.fromisoformat(ex['endDate']):
        raise CommandError('Exhibition dates are reversed.')
    rows = data['items']
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise CommandError('Expected 1 to 200 works.')
    total = 0
    for row in rows:
        exact_fields(row, 'id recordId assetId file sha256 title artist year description source referenceUrl contentOrigin identityStatus rightsStatus summary guide')
        for key in ('id', 'recordId', 'assetId'):
            identifier(row[key])
        for key, maximum in [('title', 200), ('artist', 100), ('year', 50), ('description', 10000), ('source', 300), ('summary', 200)]:
            text(row[key], maximum, allow_empty=key in ('year', 'summary'))
        url = text(row['referenceUrl'], 2000)
        from urllib.parse import urlsplit
        parsed = urlsplit(url)
        allowed_schemes = ('http', 'https') if allow_http_reference else ('https',)
        if parsed.scheme not in allowed_schemes or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in url):
            raise CommandError('Expected an allowed HTTP(S) metadata reference without credentials or whitespace.')
        if row['contentOrigin'] != 'team_draft' or row['identityStatus'] != 'candidate' or row['rightsStatus'] != 'unverified':
            raise CommandError('Intake v1 accepts candidate identity and unreviewed team draft only.')
        guide = row['guide']
        exact_fields(guide, 'intro questions hints')
        text(guide['intro'], 1000, allow_empty=True)
        if (not isinstance(guide['questions'], list) or not isinstance(guide['hints'], list) or
                len(guide['questions']) != len(guide['hints']) or len(guide['questions']) > 3):
            raise CommandError('Expected zero to three paired guide questions and hints.')
        for value in guide['questions'] + guide['hints']:
            text(value, 1000)
        if bool(guide['intro']) != bool(guide['questions']):
            raise CommandError('A guide requires both intro and question pairs.')
        total += len(local_image(root, row))
        if total > MAX_TOTAL_BYTES:
            raise CommandError('Image bundle exceeds 100MiB.')
    for key in ('id', 'recordId', 'assetId', 'file'):
        # Windows와 Linux에서 이름 대소문자 충돌로 다른 파일을 덮어쓰지 않게 합니다.
        values = [row[key].casefold() for row in rows]
        if len(set(values)) != len(values):
            raise CommandError('Duplicate intake mapping or image name.')
    return data, hashlib.sha256(raw).hexdigest()


# dry-run과 실제 적재는 같은 검사를 사용하고, 명시한 초안 전시에만 신규 작품을 추가합니다.
class Command(BaseCommand):
    help = 'Create a draft exhibition and source_check works from a validated intake v1 bundle; never approve or overwrite.'

    def add_arguments(self, parser):
        parser.add_argument('directory', type=Path)
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--append-to-draft', action='store_true')
        parser.add_argument('--expected-version', type=int)
        parser.add_argument('--allow-http-reference', action='store_true',
                            help='Store an explicitly verified legacy HTTP reference as metadata only; never fetch URLs.')

    def draft_target(self, data, expected, locked=False):
        query = Exhibition.objects.select_for_update() if locked else Exhibition.objects
        ex = query.filter(pk=data['id']).first()
        if ex is None or ex.status != 'draft' or ex.version != expected or not ex.subtitle.startswith('[시연 재구성] '):
            raise CommandError('Append requires an existing draft exhibition at the expected version.')
        if (ex.title != data['title'] or ex.venue != data['venue'] or
                ex.start_date.isoformat() != data['startDate'] or ex.end_date.isoformat() != data['endDate']):
            raise CommandError('Append cannot change exhibition identity, venue or dates.')
        # 추가 배치의 설명만 명시 갱신합니다. 도면·입구·방은 그대로 보존합니다.
        ex.subtitle = '[시연 재구성] ' + data['subtitle']
        ex.full_clean()
        return ex

    def handle(self, *args, **options):
        created = []
        try:
            root = options['directory'].resolve()
            # 예외는 메타데이터 URL 저장에만 적용하며, 원격 호출/TLS 설정을 바꾸지 않습니다.
            data, digest = read_bundle(root, allow_http_reference=options['allow_http_reference'])
            append = options['append_to_draft']
            expected = options['expected_version']
            if (append and (type(expected) is not int or expected < 1)) or (not append and expected is not None):
                raise CommandError('Use --append-to-draft together with a positive --expected-version only.')
            ex_data, rows = data['exhibition'], data['items']
            if (not append and Exhibition.objects.filter(pk=ex_data['id']).exists()) or Artwork.objects.filter(pk__in=[r['id'] for r in rows]).exists():
                raise CommandError('Target IDs exist; no overwrite, update or reset supported.')
            media = settings.MEDIA_ROOT
            if media.resolve() == root:
                raise CommandError('Bundle and destination media must be separate directories.')
            if any((media / r['file']).exists() or (media / r['file']).is_symlink() for r in rows):
                raise CommandError('Destination media exists; preserve and compare it separately.')
            if append:
                ex = self.draft_target(ex_data, expected)
            else:
                ex = Exhibition(id=ex_data['id'], title=ex_data['title'], subtitle='[시연 재구성] ' + ex_data['subtitle'], venue=ex_data['venue'],
                                start_date=ex_data['startDate'], end_date=ex_data['endDate'], status='draft', rooms=[])
                ex.full_clean()
            works = [Artwork(id=r['id'], exhibition=ex, title=r['title'], artist=r['artist'], year=r['year'],
                             description=r['description'],
                             source=f"팀작성 초안·식별/권리 확인 대기 | {r['recordId']} | {r['assetId']} | {r['source']}",
                             reference_url=r['referenceUrl'],
                             image_file=r['file'], show_image=False, review_status='source_check', tags=[],
                             summary=r['summary'], summary_status='suggested' if r['summary'] else 'none',
                             guide_intro=r['guide']['intro'], guided_looking=r['guide']['questions'], guided_hints=r['guide']['hints'],
                             guide_status='suggested' if r['guide']['intro'] else 'none') for r in rows]
            for work in works:
                work.full_clean(exclude=['exhibition'])
            if not options['dry_run']:
                media.mkdir(parents=True, exist_ok=True)
                with transaction.atomic():
                    if append:
                        ex = self.draft_target(ex_data, expected, locked=True)
                        ex.version += 1
                        ex.save(update_fields=['subtitle', 'version', 'updated_at'])
                    else:
                        ex.save(force_insert=True)
                    for row, work in zip(rows, works):
                        raw = local_image(root, row)  # 검사 후 바뀐 입력 파일도 거절합니다.
                        target = media / row['file']
                        with target.open('xb') as output:
                            created.append(target)
                            output.write(raw)
                        work.exhibition = ex
                        work.save(force_insert=True)
            result = {'ok': True, 'dryRun': options['dry_run'], 'exhibitionId': ex.id,
                'works': len(rows), 'imagesVerified': len(rows), 'manifestSha256': digest,
                'exhibitionStatus': 'draft', 'exhibitionVersion': ex.version, 'appendToDraft': append,
                'reviewStatus': 'source_check', 'publicWorks': 0,
                'accountsImported': 0, 'layoutImported': False, 'approvalImported': False,
                'httpReferenceAllowed': options['allow_http_reference']}
        except Exception as exc:
            # 이번 호출이 새로 만든 파일만 회수합니다. 기존 DB/미디어는 지우지 않습니다.
            for target in created:
                target.unlink(missing_ok=True)
            if isinstance(exc, CommandError):
                raise
            if isinstance(exc, (OSError, ValueError, TypeError, KeyError, ValidationError)):
                raise CommandError('Invalid bundle or failed create-only intake; no approval performed.') from exc
            raise

        # 커밋 후 출력 실패는 이미 저장된 이미지/DB를 훼손하지 않습니다.
        self.stdout.write(json.dumps(result))
