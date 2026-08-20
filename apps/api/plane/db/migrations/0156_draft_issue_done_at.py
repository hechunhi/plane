# BARSOUL 2026-08: 個人 ToDo(下書き)の「済」列。
# 既存の `completed_at` は state.group 連動なので相乗りさせない。
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0155_meeting_chat_attachment")]

    operations = [
        migrations.AddField(
            model_name="draftissue",
            name="done_at",
            field=models.DateTimeField(blank=True, null=True),
        )
    ]
