import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0013_operation_text_model_usage')]

    operations = [
        migrations.CreateModel(
            name='OperationTextModelUsage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('task', models.CharField(max_length=16)),
                ('model', models.CharField(blank=True, max_length=200)),
                ('attempts', models.PositiveIntegerField()),
                ('measured', models.PositiveIntegerField()),
                ('input_tokens', models.PositiveBigIntegerField()),
                ('output_tokens', models.PositiveBigIntegerField()),
                ('cache_measured', models.PositiveIntegerField()),
                ('cached_input_tokens', models.PositiveBigIntegerField()),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='arti.operationevent')),
            ],
            options={'constraints': [models.UniqueConstraint(fields=('event', 'task', 'model'),
                                                              name='operation_text_usage_group_unique')]},
        ),
    ]
