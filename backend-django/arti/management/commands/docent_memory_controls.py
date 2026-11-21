"""Reconcile cross-exhibition memory settings after restoring a synthetic backup."""

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from arti.docent_memory import account_memory_state, cross_visit_cutoff, cross_visit_records, discard_cross_visit_memory
from arti.models import Account


class Command(BaseCommand):
    help = 'Export or restore synthetic account memory controls, or prune expired visit summaries.'

    def add_arguments(self, parser):
        action = parser.add_mutually_exclusive_group(required=True)
        action.add_argument('--export', type=Path)
        action.add_argument('--apply', type=Path)
        action.add_argument('--prune', action='store_true')

    def handle(self, **options):
        if settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES:
            raise CommandError('합성 검수 DB에서만 실행할 수 있습니다.')
        if path := options['export']:
            exported = []
            for account in Account.objects.filter(role='user', docent_memory_revision__gt=0).order_by('pk').iterator():
                state = account_memory_state(account)
                state.pop('retentionDays')
                exported.append({'accountId': account.pk, **state})
            try:
                with path.open('x', encoding='utf-8') as stream:
                    json.dump({'format': 1, 'accounts': exported}, stream)
            except OSError as error:
                raise CommandError('계정별 기억 설정을 새 파일에 보관할 수 없습니다.') from error
            self.stdout.write(f'Exported {len(exported)} controls.')
            return

        changed = removed = 0
        if path := options['apply']:
            controls = self.read_controls(path)
            with transaction.atomic():
                for account in Account.objects.select_for_update().filter(pk__in=controls, role='user').order_by('pk'):
                    enabled, revision, reset_at = controls[account.pk]
                    if revision > account.docent_memory_revision:
                        account.docent_cross_visit_enabled = enabled
                        account.docent_memory_revision = revision
                        account.docent_memory_reset_at = reset_at
                        account.save(update_fields=[
                            'docent_cross_visit_enabled', 'docent_memory_revision', 'docent_memory_reset_at',
                        ])
                        changed += 1
                    if account.docent_memory_reset_at:
                        removed += discard_cross_visit_memory(
                            cross_visit_records().filter(user=account, created_at__lte=account.docent_memory_reset_at)
                        )
        with transaction.atomic():
            expired = discard_cross_visit_memory(cross_visit_records().filter(created_at__lte=cross_visit_cutoff()))
        self.stdout.write(f'Applied {changed} controls, removed {removed} reset and {expired} expired summaries.')

    @staticmethod
    def read_controls(path):
        try:
            if path.stat().st_size > 1024 * 1024:
                raise ValueError('controls are too large')
            data = json.loads(path.read_text(encoding='utf-8'))
            if set(data) != {'format', 'accounts'} or type(data['format']) is not int or data['format'] != 1:
                raise ValueError('unknown controls format')
            if not isinstance(data['accounts'], list):
                raise ValueError('expected a list of controls')
            controls = {}
            now = timezone.now()
            for entry in data['accounts']:
                if set(entry) != {'accountId', 'enabled', 'revision', 'resetAt'}:
                    raise ValueError('unknown control fields')
                account_id, enabled, revision = entry['accountId'], entry['enabled'], entry['revision']
                reset_at = parse_datetime(entry['resetAt']) if entry['resetAt'] is not None else None
                if (not isinstance(account_id, str) or not 1 <= len(account_id) <= 64 or account_id in controls
                        or type(enabled) is not bool or type(revision) is not int or not 0 < revision < 2**63
                        or (entry['resetAt'] is not None and
                            (reset_at is None or timezone.is_naive(reset_at) or reset_at > now))):
                    raise ValueError('invalid memory control')
                controls[account_id] = (enabled, revision, reset_at)
            return controls
        except (OSError, TypeError, ValueError, KeyError) as error:
            raise CommandError('저장한 기억 설정 파일의 형식과 값을 확인해 주세요.') from error
