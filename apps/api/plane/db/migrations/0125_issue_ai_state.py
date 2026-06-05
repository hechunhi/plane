# BARSOUL: 派生卡片当前态 (Derived Issue State, DIS)。
# 真相=issue + comments + activity, 派生=本表; 原 issue 永不修改。
# 详 docs/architecture/derived-issue-state-mvp.md。

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0124_commenttranslation_source_hash"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueAIState",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("state", models.CharField(default="UNKNOWN", max_length=8)),
                ("ball", models.CharField(blank=True, default="", max_length=8)),
                ("current_actor", models.CharField(blank=True, default="", max_length=120)),
                ("owner", models.CharField(blank=True, default="", max_length=120)),
                ("next_action", models.CharField(blank=True, default="", max_length=120)),
                ("due_date", models.DateField(blank=True, null=True)),
                ("stale_days", models.IntegerField(default=0)),
                ("confidence", models.FloatField(default=0.0)),
                ("reasoning", models.TextField(blank=True, default="")),
                ("model_used", models.CharField(blank=True, default="", max_length=40)),
                ("source_hash", models.CharField(blank=True, db_index=True, default="", max_length=64)),
                ("schema_version", models.PositiveSmallIntegerField(default=1)),
                ("issue", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="ai_state", to="db.issue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_issueaistate", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_issueaistate", to="db.workspace")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issueaistate_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issueaistate_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
            ],
            options={
                "verbose_name": "Issue AI State",
                "verbose_name_plural": "Issue AI States",
                "db_table": "issue_ai_states",
            },
        ),
        migrations.AddIndex(
            model_name="issueaistate",
            index=models.Index(fields=["project", "state"], name="issue_ai_states_proj_state_idx"),
        ),
        migrations.AddIndex(
            model_name="issueaistate",
            index=models.Index(fields=["workspace", "ball", "owner"], name="issue_ai_states_ws_ball_owner_idx"),
        ),
    ]
