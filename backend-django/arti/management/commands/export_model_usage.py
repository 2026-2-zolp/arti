import json
from datetime import datetime, timezone

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum
from django.utils.timezone import now

from arti.models import OperationEvent
from arti.operations import text_model_usage_groups


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise CommandError('Use ISO timestamps with a UTC offset.') from exc
    if parsed.utcoffset() is None:
        raise CommandError('Use ISO timestamps with a UTC offset.')
    return parsed.astimezone(timezone.utc)


class Command(BaseCommand):
    help = 'Export anonymous task/model token totals for a completed [start, end) interval.'

    def add_arguments(self, parser):
        for option in ('project', 'start', 'end'):
            parser.add_argument('--' + option, required=True)

    def handle(self, *args, **options):
        start, end = (timestamp(options[name]) for name in ('start', 'end'))
        project = options['project'].strip()
        if not project or not start < end <= now():
            raise CommandError('Supply a project label and a completed interval with start < end.')
        events = OperationEvent.objects.filter(occurred_at__gte=start, occurred_at__lt=end)
        rows = text_model_usage_groups(events)
        attempts = events.aggregate(total=Sum('text_model_attempts', default=0))['total']
        grouped = sum(row['attempts'] for row in rows)
        if grouped > attempts:
            raise CommandError('Usage changed during export. Rerun for an interval that has ended.')
        self.stdout.write(json.dumps({'project': project, 'start': start.isoformat(), 'end': end.isoformat(),
                                      'ungroupedAttempts': attempts - grouped, 'rows': rows}, ensure_ascii=False))
