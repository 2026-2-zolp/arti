"""Run inside a release image with manage.py shell -c before an image-only rollback."""
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder


expected = set(MigrationLoader(None).disk_migrations)
applied = set(MigrationRecorder(connection).applied_migrations())
if expected != applied:
    print(f'Release schema differs: {len(expected - applied)} missing, {len(applied - expected)} extra migrations.')
    raise SystemExit(3)
print(f'Release schema matches: {len(applied)} migrations.')
