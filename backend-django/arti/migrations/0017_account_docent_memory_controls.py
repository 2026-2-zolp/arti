from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0016_visit_docent_memory')]

    operations = [
        migrations.AddField(
            model_name='account', name='docent_cross_visit_enabled',
            field=models.BooleanField(default=True, db_default=True),
        ),
        migrations.AddField(
            model_name='account', name='docent_memory_revision',
            field=models.PositiveBigIntegerField(default=0, db_default=0),
        ),
        migrations.AddField(
            model_name='account', name='docent_memory_reset_at',
            field=models.DateTimeField(blank=True, default=None, null=True),
        ),
    ]
