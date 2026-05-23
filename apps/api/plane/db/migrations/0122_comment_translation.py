# BARSOUL: 评论翻译派生层 (愛ちゃん 自动翻译内嵌化)
# 真相=原 IssueComment, 派生=本表; 原评论永不修改。详 ADR 待补。

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0121_alter_estimate_type"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CommentTranslation",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("target_lang", models.CharField(max_length=8)),
                ("source_lang", models.CharField(blank=True, default="", max_length=8)),
                ("text", models.TextField(blank=True, default="")),
                ("translated_by", models.CharField(blank=True, default="aichan", max_length=64)),
                ("comment", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="translations", to="db.issuecomment")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_commenttranslation", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_commenttranslation", to="db.workspace")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="commenttranslation_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="commenttranslation_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
            ],
            options={
                "verbose_name": "Comment Translation",
                "verbose_name_plural": "Comment Translations",
                "db_table": "comment_translations",
            },
        ),
        migrations.AddConstraint(
            model_name="commenttranslation",
            constraint=models.UniqueConstraint(fields=("comment", "target_lang"), name="uniq_comment_translation_per_lang"),
        ),
        migrations.AddIndex(
            model_name="commenttranslation",
            index=models.Index(fields=["comment", "target_lang"], name="comment_translations_comment_lang_idx"),
        ),
    ]
