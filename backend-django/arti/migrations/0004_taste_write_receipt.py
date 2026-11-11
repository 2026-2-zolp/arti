from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0003_tag_score_evidence')]
    operations = [
        migrations.AddField(
            model_name='account', name='taste_write_receipt',
            field=models.JSONField(blank=True, default=None, null=True),
        ),
    ]
