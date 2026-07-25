# BARSOUL 週次発言モジュール磨き P1 (hechun 2026-07-25): 発言の編集(edited_at)と
# 絵文字リアクション(MeetingChatReaction)。docs/architecture/weekly-report-mvp.md。
# 手書き移行(本リポ約定: deleted_at 必須), 書式は 0151_weekly_meeting に倣う。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def _audit():
    return [
        ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
        ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
        ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
        ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
    ]


def _actor(model_name):
    return [
        ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name=f"{model_name}_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
        ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name=f"{model_name}_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
    ]


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0152_weekly_draft_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingchatmessage",
            name="edited_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="MeetingChatReaction",
            fields=_audit() + [
                ("reaction", models.CharField(max_length=32)),
            ] + _actor("meetingchatreaction") + [
                ("actor", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="meeting_chat_reactions", to=settings.AUTH_USER_MODEL)),
                ("message", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="reactions", to="db.meetingchatmessage")),
            ],
            options={
                "verbose_name": "Meeting Chat Reaction",
                "verbose_name_plural": "Meeting Chat Reactions",
                "db_table": "meeting_chat_reactions",
                "ordering": ("created_at",),
            },
        ),
        migrations.AddConstraint(
            model_name="meetingchatreaction",
            constraint=models.UniqueConstraint(
                condition=models.Q(deleted_at__isnull=True),
                fields=("message", "actor", "reaction"),
                name="meeting_chat_reaction_unique_when_not_deleted",
            ),
        ),
    ]
