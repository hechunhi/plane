# BARSOUL 2026-06-15 (hechun): issue 标题/正文の表示翻訳キャッシュ(IssueTranslation)。
# 評論翻訳(CommentTranslation, 0122)と同型 — 原 issue は不可変, 本表は派生キャッシュのみ。
# 手写迁移(本仓约定: 必含 deleted_at), 字段照 0141_recurring_rule / 0122_comment_translation。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0144_issue_ai_state_subtree"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueTranslation",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("field", models.CharField(max_length=16)),
                ("target_lang", models.CharField(max_length=8)),
                ("source_lang", models.CharField(blank=True, default="", max_length=8)),
                ("text", models.TextField(blank=True, default="")),
                ("translated_by", models.CharField(blank=True, default="aichan", max_length=64)),
                ("source_hash", models.CharField(blank=True, db_index=True, default="", max_length=64)),
                ("issue", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="translations", to="db.issue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_issuetranslation", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_issuetranslation", to="db.workspace")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issuetranslation_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issuetranslation_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
            ],
            options={
                "verbose_name": "Issue Translation",
                "verbose_name_plural": "Issue Translations",
                "db_table": "issue_translations",
            },
        ),
        migrations.AddConstraint(
            model_name="issuetranslation",
            constraint=models.UniqueConstraint(fields=("issue", "field", "target_lang"), name="uniq_issue_translation_per_field_lang"),
        ),
        migrations.AddIndex(
            model_name="issuetranslation",
            index=models.Index(fields=["issue", "field", "target_lang"], name="issue_tr_issue_field_lang_idx"),
        ),
    ]
