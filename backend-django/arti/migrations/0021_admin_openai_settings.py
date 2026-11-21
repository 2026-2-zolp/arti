from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0020_docent_transcripts')]

    operations = [
        migrations.CreateModel(
            name='AdminOpenAISettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled', models.BooleanField(default=False)),
                ('model', models.CharField(max_length=200)),
                ('encrypted_key', models.BinaryField(default=bytes, editable=False)),
                ('revision', models.PositiveBigIntegerField(default=0)),
            ],
            options={
                'constraints': [models.CheckConstraint(condition=models.Q(pk=1), name='admin_openai_settings_singleton')],
            },
        ),
    ]
