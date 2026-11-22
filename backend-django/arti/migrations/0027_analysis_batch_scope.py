import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0026_artwork_analysis_batch')]

    operations = [
        migrations.AddField(
            model_name='artworkanalysisbatch',
            name='run_id',
            field=models.UUIDField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='emotionjob',
            name='batch_item',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    to='arti.artworkanalysisitem'),
        ),
    ]
