from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0007_visit_interpretation_versions')]

    operations = [
        migrations.AddField(
            model_name='artwork',
            name='retained_text',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
