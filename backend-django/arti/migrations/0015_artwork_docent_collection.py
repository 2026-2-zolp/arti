from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0014_operation_text_model_usage_groups')]

    operations = [
        migrations.AddField(
            model_name='artwork',
            name='docent_collection',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
