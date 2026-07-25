# BARSOUL 週次ミーティング支援 (hechun 2026-07-24): 下書き生成を非同期化したので
# 画面が「生成中 / 失敗」を出せるよう状態列を足す。純粋な追加(既存行は "" = 未生成)。
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0151_weekly_meeting")]

    operations = [
        migrations.AddField(
            model_name="weeklyreportentry",
            name="draft_status",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
    ]
