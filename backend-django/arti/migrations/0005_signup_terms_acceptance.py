import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0004_taste_write_receipt')]
    operations = [
        migrations.CreateModel(
            name='SignupTermsAcceptance',
            fields=[
                ('account', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                                 primary_key=True, serialize=False, to='arti.account')),
                ('version', models.CharField(max_length=64)),
                ('accepted_at', models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
    ]
