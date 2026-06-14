# BARSOUL: 定期タスク / 周期任务(IUTEYA-15)— recurring_rules.
# 见 docs/architecture/recurring-tasks-mvp.md。手写迁移(本仓约定: 必含 deleted_at), 字段照 0137_blueprint。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0140_smart_row_meta"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RecurringRule",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("cadence", models.CharField(choices=[("weekly", "weekly"), ("monthly", "monthly"), ("quarterly", "quarterly"), ("yearly", "yearly")], default="monthly", max_length=12)),
                ("anchor", models.JSONField(blank=True, default=dict)),
                ("lead_days", models.PositiveSmallIntegerField(default=0)),
                ("labels", models.JSONField(blank=True, default=list)),
                ("template", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(choices=[("active", "active"), ("paused", "paused"), ("archived", "archived")], default="active", max_length=12)),
                ("skip_next", models.BooleanField(default=False)),
                ("next_run_at", models.DateTimeField(blank=True, null=True)),
                ("last_period_key", models.CharField(blank=True, default="", max_length=24)),
                ("last_run_at", models.DateTimeField(blank=True, null=True)),
                ("fail_count", models.PositiveSmallIntegerField(default=0)),
                ("assignee", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurring_assigned", to=settings.AUTH_USER_MODEL)),
                ("blueprint", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurring_rules", to="db.blueprint")),
                ("last_generated_issue", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="db.issue")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurringrule_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_recurringrule", to="db.project")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="recurringrule_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_recurringrule", to="db.workspace")),
            ],
            options={"verbose_name": "Recurring Rule", "verbose_name_plural": "Recurring Rules", "db_table": "recurring_rules", "ordering": ["name"]},
        ),
        migrations.AddIndex(model_name="recurringrule", index=models.Index(fields=["project"], name="recurring_project_idx")),
        migrations.AddIndex(model_name="recurringrule", index=models.Index(fields=["status", "next_run_at"], name="recurring_status_next_idx")),
    ]
