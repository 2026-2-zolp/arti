import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0011_operation_analysis_failures')]

    operations = [
        migrations.CreateModel(
            name='PasswordResetDelivery',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email_key', models.CharField(db_index=True, max_length=64)),
                ('token_id', models.UUIDField(unique=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('next_attempt_at', models.DateTimeField()),
                ('processed_at', models.DateTimeField(default=None, null=True)),
                ('delivered', models.BooleanField(default=False)),
                ('account', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to='arti.account')),
            ],
        ),
    ]
