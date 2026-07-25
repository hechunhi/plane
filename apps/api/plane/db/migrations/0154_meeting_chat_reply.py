# BARSOUL 週次発言モジュール磨き P1 Slice2 (hechun 2026-07-25): 引用返信
# (MeetingChatMessage.reply_to = 自己参照 FK)。docs/architecture/weekly-report-mvp.md。
# 手書き移行(本リポ約定)。親が取り消されても返信は残す = SET_NULL。
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0153_meeting_chat_actions"),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingchatmessage",
            name="reply_to",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="replies",
                to="db.meetingchatmessage",
            ),
        ),
    ]
