from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0012_password_reset_delivery')]

    operations = [
        migrations.AddField('operationevent', 'text_model_attempts', models.PositiveIntegerField(default=0)),
        migrations.AddField('operationevent', 'text_model_measured', models.PositiveIntegerField(default=0)),
        migrations.AddField('operationevent', 'text_model_input_tokens', models.PositiveBigIntegerField(default=0)),
        migrations.AddField('operationevent', 'text_model_output_tokens', models.PositiveBigIntegerField(default=0)),
    ]
