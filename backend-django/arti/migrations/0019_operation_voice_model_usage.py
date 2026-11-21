from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('arti', '0018_exhibition_direct_visit_order')]

    operations = [
        migrations.CreateModel(
            name='OperationVoiceModelUsage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('intent', models.CharField(max_length=7)),
                ('model', models.CharField(max_length=200)),
                ('input_tokens', models.PositiveBigIntegerField(null=True)),
                ('output_tokens', models.PositiveBigIntegerField(null=True)),
                ('cached_input_tokens', models.PositiveBigIntegerField(null=True)),
                ('output_audio_tokens', models.PositiveBigIntegerField(null=True)),
                ('estimated_cost_usd', models.DecimalField(decimal_places=9, max_digits=17, null=True)),
                ('event', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to='arti.operationevent')),
            ],
        ),
    ]
