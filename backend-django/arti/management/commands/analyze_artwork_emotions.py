from time import sleep

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from arti.emotion_jobs import enabled, process_next


class Command(BaseCommand):
    help = 'Process queued artwork emotion analysis.'

    def add_arguments(self, parser):
        parser.add_argument('--watch', action='store_true')

    def handle(self, *args, **options):
        if not enabled():
            raise CommandError('Enable background emotion analysis and configure the model service first.')
        if not options['watch']:
            return 'Processed one emotion job.' if process_next() else 'No eligible emotion job.'
        while True:
            close_old_connections()
            if not process_next():
                sleep(2)
