from datetime import timedelta

from django.db import migrations, models
from django.utils import timezone


def protect_recently_changed_artworks(apps, schema_editor):
    artwork = apps.get_model('arti', 'Artwork')
    period = timedelta(hours=72)
    # Historical rows lack a withdrawal timestamp. A recent nonpublic edit could be a withdrawal.
    (artwork.objects.using(schema_editor.connection.alias).exclude(review_status='approved')
     .filter(updated_at__gt=timezone.now() - period)
     .update(receipt_protected_until=models.F('updated_at') + period))


class Migration(migrations.Migration):
    dependencies = [('arti', '0023_exhibition_poster')]
    operations = [
        migrations.AddField(
            model_name='artwork',
            name='receipt_protected_until',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(protect_recently_changed_artworks, migrations.RunPython.noop),
    ]
