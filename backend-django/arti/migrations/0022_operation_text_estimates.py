from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0021_admin_openai_settings')]

    operations = [
        migrations.AddField(
            model_name='operationtextmodelusage',
            name='priced',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='operationtextmodelusage',
            name='estimated_cost_usd',
            field=models.DecimalField(max_digits=17, decimal_places=9, default=0),
        ),
    ]
