import json
from time import sleep

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from django.db.models import Count, Q
from django.utils import timezone

from arti.models import PasswordResetDelivery
from arti.password_reset import deliver_pending, purge_expired_deliveries, reset_enabled


class Command(BaseCommand):
    help = 'Send a batch of queued password reset messages and remove expired requests.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--status', action='store_true', help='Read anonymous queue counts without sending mail.')
        mode.add_argument('--watch', action='store_true', help='Run a batch every minute in a dedicated worker.')
        mode.add_argument('--purge-expired', action='store_true', help='Remove expired requests without sending mail.')

    def handle(self, *args, **options):
        if options['status']:
            return self.queue_status()
        if options['purge_expired']:
            return f'Expired password reset requests removed: {purge_expired_deliveries()}'
        if not options['watch']:
            return f'Password reset messages sent: {deliver_pending()}'
        if not reset_enabled():
            raise CommandError('Password reset origin and sender are required for the mail worker.')
        self.stdout.write('Password reset mail worker started.')
        while True:
            close_old_connections()
            sent = deliver_pending()
            if sent:
                self.stdout.write(f'Password reset messages sent: {sent}')
            sleep(60)

    def queue_status(self):
        now = timezone.now()
        queue = PasswordResetDelivery.objects.filter(processed_at__isnull=True)
        active = Q(expires_at__gt=now)
        counts = queue.aggregate(ready=Count('id', filter=active & Q(next_attempt_at__lte=now)),
                                 deferred=Count('id', filter=active & Q(next_attempt_at__gt=now)),
                                 expired=Count('id', filter=Q(expires_at__lte=now)))
        return json.dumps({'enabled': reset_enabled(), **counts})
