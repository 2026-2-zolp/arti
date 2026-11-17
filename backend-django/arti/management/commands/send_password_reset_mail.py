from django.core.management.base import BaseCommand

from arti.password_reset import deliver_pending


class Command(BaseCommand):
    help = 'Send a batch of queued password reset messages and remove expired requests.'

    def handle(self, *args, **options):
        self.stdout.write(f'Password reset messages sent: {deliver_pending()}')
