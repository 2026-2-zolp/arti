from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0022_operation_text_estimates')]

    operations = [
        migrations.AddField(
            model_name='exhibition',
            name='poster_file',
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
    ]
