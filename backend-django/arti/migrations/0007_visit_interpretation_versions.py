from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0006_kakao_oauth')]
    operations = [
        migrations.AddField(
            model_name='visit',
            name='interpretation_request_version',
            field=models.PositiveBigIntegerField(default=0, db_default=0),
        ),
        migrations.AddField(
            model_name='visit',
            name='interpretation_saved_version',
            field=models.PositiveBigIntegerField(default=0, db_default=0),
        ),
    ]
