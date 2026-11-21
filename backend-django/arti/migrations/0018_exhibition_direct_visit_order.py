from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0017_account_docent_memory_controls')]

    operations = [
        migrations.AddField(
            model_name='exhibition',
            name='direct_visit_order',
            field=models.JSONField(blank=True, db_default=[], default=list),
        ),
    ]
