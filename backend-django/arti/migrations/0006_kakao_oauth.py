import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0005_signup_terms_acceptance')]
    operations = [
        migrations.CreateModel(
            name='KakaoIdentity',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('account', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='arti.account')),
                ('client_id', models.CharField(max_length=128)),
                ('subject', models.CharField(max_length=255)),
            ],
            options={'constraints': [
                models.UniqueConstraint(fields=('client_id', 'subject'), name='kakao_unique_subject'),
                models.UniqueConstraint(fields=('client_id', 'account'), name='kakao_unique_account'),
            ]},
        ),
        migrations.CreateModel(
            name='KakaoOAuthFlow',
            fields=[
                ('browser_hash', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('state_hash', models.CharField(max_length=64)),
                ('client_id', models.CharField(max_length=128)),
                ('account', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to='arti.account')),
                ('session_hash', models.CharField(blank=True, max_length=64)),
                ('nonce', models.CharField(max_length=64)),
                ('verifier', models.CharField(max_length=64)),
                ('return_path', models.CharField(max_length=500)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('status', models.CharField(default='pending', max_length=12)),
                ('subject', models.CharField(blank=True, max_length=255)),
            ],
        ),
    ]
