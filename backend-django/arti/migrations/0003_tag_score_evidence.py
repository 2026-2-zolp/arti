# 기존 점수·승인·풀을 수정하지 않고 출처와 재분석 revision 저장 공간만 추가합니다.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('arti', '0002_independent_taste_survey')]

    operations = [
        migrations.AddField(model_name='artwork', name='tag_score_evidence',
                            field=models.JSONField(blank=True, default=None, null=True)),
        migrations.AddField(model_name='artwork', name='tag_score_revision',
                            field=models.PositiveIntegerField(default=0)),
    ]
