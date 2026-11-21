import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0019_operation_voice_model_usage')]

    operations = [
        migrations.CreateModel(
            name='DocentTranscriptConsent',
            fields=[
                ('account', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                                primary_key=True, serialize=False, to='arti.account')),
                ('version', models.CharField(max_length=64)),
                ('consented_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('revision', models.PositiveBigIntegerField(default=0)),
            ],
        ),
        migrations.CreateModel(
            name='DocentTranscript',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('visit_id', models.UUIDField()),
                ('turns', models.JSONField(default=list)),
                ('deleted', models.BooleanField(default=False)),
                ('account', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='arti.account')),
                ('artwork', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='arti.artwork')),
            ],
            options={'constraints': [models.UniqueConstraint(
                fields=('account', 'artwork', 'visit_id'), name='docent_transcript_owner_work_visit_unique',
            )]},
        ),
    ]
