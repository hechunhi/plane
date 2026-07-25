# BARSOUL 週次ミーティング支援 (hechun 2026-07-21): 会期 + 週報 + 会議チャット +
# 汎用翻訳キャッシュ。docs/architecture/weekly-report-mvp.md v2。
# 手書き移行(本リポ約定: deleted_at 必須), 書式は 0150_inbox_state に倣う。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def _audit():
    """全モデル共通の監査列(created_at / updated_at / deleted_at / id)。"""
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
        ("db", "0150_inbox_state"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WeeklyMeeting",
            fields=_audit() + [
                ("title", models.CharField(blank=True, default="", max_length=255)),
                ("period_start", models.DateTimeField()),
                ("period_end", models.DateTimeField()),
                ("status", models.CharField(default="OPEN", max_length=16)),
                ("held_at", models.DateTimeField(blank=True, null=True)),
            ] + _actor("weeklymeeting") + [
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="weekly_meetings", to="db.workspace")),
                ("page", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="weekly_meetings", to="db.page")),
            ],
            options={
                "verbose_name": "Weekly Meeting",
                "verbose_name_plural": "Weekly Meetings",
                "db_table": "weekly_meetings",
                "ordering": ("-period_end",),
            },
        ),
        migrations.CreateModel(
            name="WeeklyReportEntry",
            fields=_audit() + [
                ("stats", models.JSONField(default=dict)),
                ("sources", models.JSONField(default=list)),
                ("draft_html", models.TextField(blank=True, default="")),
                ("content_html", models.TextField(blank=True, default="")),
                ("model_used", models.CharField(blank=True, default="", max_length=64)),
                ("generated_at", models.DateTimeField(blank=True, null=True)),
                ("edited_at", models.DateTimeField(blank=True, null=True)),
            ] + _actor("weeklyreportentry") + [
                ("meeting", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="entries", to="db.weeklymeeting")),
                ("member", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="weekly_report_entries", to=settings.AUTH_USER_MODEL)),
                ("edited_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="weekly_report_edits", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Weekly Report Entry",
                "verbose_name_plural": "Weekly Report Entries",
                "db_table": "weekly_report_entries",
                "ordering": ("member__display_name",),
            },
        ),
        migrations.CreateModel(
            name="MeetingChatMessage",
            fields=_audit() + [
                ("text", models.TextField()),
                ("source_lang", models.CharField(blank=True, default="", max_length=8)),
            ] + _actor("meetingchatmessage") + [
                ("meeting", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="chat_messages", to="db.weeklymeeting")),
            ],
            options={
                "verbose_name": "Meeting Chat Message",
                "verbose_name_plural": "Meeting Chat Messages",
                "db_table": "meeting_chat_messages",
                "ordering": ("created_at",),
            },
        ),
        migrations.CreateModel(
            name="ContentTranslation",
            fields=_audit() + [
                ("entity", models.CharField(max_length=32)),
                ("object_id", models.UUIDField(db_index=True)),
                ("field", models.CharField(default="content", max_length=32)),
                ("target_lang", models.CharField(max_length=8)),
                ("source_lang", models.CharField(blank=True, default="", max_length=8)),
                ("text", models.TextField(blank=True, default="")),
                ("translated_by", models.CharField(blank=True, default="aichan", max_length=64)),
                ("source_hash", models.CharField(blank=True, db_index=True, default="", max_length=64)),
            ] + _actor("contenttranslation") + [
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="content_translations", to="db.workspace")),
            ],
            options={
                "verbose_name": "Content Translation",
                "verbose_name_plural": "Content Translations",
                "db_table": "content_translations",
            },
        ),
        migrations.AddConstraint(
            model_name="weeklyreportentry",
            constraint=models.UniqueConstraint(fields=("meeting", "member"), name="uniq_weekly_entry_per_member"),
        ),
        migrations.AddConstraint(
            model_name="contenttranslation",
            constraint=models.UniqueConstraint(fields=("entity", "object_id", "field", "target_lang"), name="uniq_content_translation"),
        ),
        migrations.AddIndex(
            model_name="meetingchatmessage",
            index=models.Index(fields=["meeting", "created_at"], name="mtg_chat_meeting_at_idx"),
        ),
        migrations.AddIndex(
            model_name="contenttranslation",
            index=models.Index(fields=["entity", "object_id", "target_lang"], name="content_tr_lookup_idx"),
        ),
    ]
