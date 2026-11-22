from time import sleep

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from arti.batch_analysis import enabled, process_next


class Command(BaseCommand):
    help = 'Process exhibition artwork analysis jobs.'

    def add_arguments(self, parser):
        parser.add_argument('--watch', action='store_true')

    def handle(self, *args, **options):
        if not enabled():
            raise CommandError('Set ARTI_BACKGROUND_BATCH_ANALYSIS=true to start this worker.')
        if not options['watch']:
            return 'Processed artwork analysis work.' if process_next() else 'No artwork analysis work due.'
        while True:
            close_old_connections()
            if not process_next():
                sleep(1)
