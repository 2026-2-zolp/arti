from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0010_exhibition_navigation')]

    operations = [
        migrations.AddField(
            model_name='operationevent',
            name='analysis_failures',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
