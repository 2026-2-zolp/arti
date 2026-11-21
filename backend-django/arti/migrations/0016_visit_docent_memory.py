from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0015_artwork_docent_collection')]
    operations = [
        migrations.AddField(
            model_name='visit',
            name='docent_memory',
            field=models.JSONField(blank=True, db_default={}, default=dict),
        ),
    ]
