# BARSOUL: DIS 人工纠正/补充 —— 人进详情向 AI 补足背景说明,AI 据此重判;留痕可追溯。
# issue_ai_states 加 human_note(双语)+ corrected_by/at;新增 append-only 审计表。

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0126_issue_ai_state_rich"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 人手补充说明(双语, 喂给 AI 重判 + 详情展示)
        migrations.AddField(model_name="issueaistate", name="human_note_zh",
            field=models.CharField(blank=True, default="", max_length=1000)),
        migrations.AddField(model_name="issueaistate", name="human_note_ja",
            field=models.CharField(blank=True, default="", max_length=1000)),
        migrations.AddField(model_name="issueaistate", name="corrected_by",
            field=models.CharField(blank=True, default="", max_length=120)),  # 显示名
        migrations.AddField(model_name="issueaistate", name="corrected_at",
            field=models.DateTimeField(blank=True, null=True)),
        # append-only 审计表(留痕): 每次人工补充/纠正一行
        migrations.CreateModel(
            name="IssueAIStateCorrection",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("note_zh", models.CharField(blank=True, default="", max_length=1000)),
                ("note_ja", models.CharField(blank=True, default="", max_length=1000)),
                ("note_lang", models.CharField(blank=True, default="", max_length=8)),  # 录入原文语言
                ("prev_ball", models.CharField(blank=True, default="", max_length=8)),
                ("prev_actor", models.CharField(blank=True, default="", max_length=120)),
                ("issue", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="ai_state_corrections", to="db.issue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_issueaistatecorrection", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_issueaistatecorrection", to="db.workspace")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issueaistatecorrection_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issueaistatecorrection_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
            ],
            options={
                "verbose_name": "Issue AI State Correction",
                "verbose_name_plural": "Issue AI State Corrections",
                "db_table": "issue_ai_state_corrections",
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="issueaistatecorrection",
            index=models.Index(fields=["issue", "-created_at"], name="ai_state_corr_issue_idx"),
        ),
    ]
