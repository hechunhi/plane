# BARSOUL 週次発言モジュール磨き P1 Slice4 (hechun 2026-07-25): 画像貼り付け
# (MeetingChatMessage.attachment = FileAsset への FK)。docs/architecture/weekly-report-mvp.md。
# 手書き移行(本リポ約定)。資産が消えても発言(SoR)は残す = SET_NULL。
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0154_meeting_chat_reply"),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingchatmessage",
            name="attachment",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="meeting_chat_messages",
                to="db.fileasset",
            ),
        ),
    ]
