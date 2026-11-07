import getpass
import os
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from arti.models import Account


class Command(BaseCommand):
    help = 'Explicitly create one administrator. Never run automatically at startup.'

    def add_arguments(self, parser):
        parser.add_argument('--login-id', required=True)
        parser.add_argument('--name', required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        password = os.environ.get('ARTI_BOOTSTRAP_PASSWORD') or getpass.getpass('New administrator password: ')
        if not 12 <= len(password) <= 128 or not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
            raise CommandError('Use 12–128 characters including letters and digits.')
        login_id = options['login_id'].strip()
        if Account.objects.filter(login_id=login_id).exists():
            raise CommandError('Account already exists. Bootstrap never overwrites credentials.')
        account = Account(login_id=login_id, nickname=options['name'], role='admin', password=make_password(password))
        account.full_clean()
        account.save()
        self.stdout.write('Administrator created. No password or session token is printed.')
