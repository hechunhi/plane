# BARSOUL: 智能表 / 项目数据库 (Smart Table). 见 docs/architecture/smart-table-mvp.md.
# 手写迁移(本仓约定:必含 deleted_at). 与 smart_table.py 模型对齐;
# 可在 api 容器内 `python manage.py makemigrations db --check` 复核无漂移.
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0129_issue_ai_state_info_framework"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SmartTable",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttable_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smarttable", to="db.project")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttable_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smarttable", to="db.workspace")),
            ],
            options={"verbose_name": "Smart Table", "verbose_name_plural": "Smart Tables", "db_table": "smart_tables"},
        ),
        migrations.CreateModel(
            name="SmartColumn",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("key", models.CharField(max_length=64)),
                ("name", models.CharField(max_length=255)),
                ("type", models.CharField(choices=[("text", "text"), ("number", "number"), ("single_select", "single_select"), ("multi_select", "multi_select"), ("date", "date"), ("checkbox", "checkbox")], default="text", max_length=20)),
                ("source", models.CharField(choices=[("manual", "manual"), ("plane", "plane"), ("keiri", "keiri"), ("ai_bot", "ai_bot")], default="manual", max_length=16)),
                ("options", models.JSONField(blank=True, default=list)),
                ("binding", models.JSONField(blank=True, default=dict)),
                ("required", models.BooleanField(default=False)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smartcolumn_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smartcolumn", to="db.project")),
                ("table", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="columns", to="db.smarttable")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smartcolumn_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smartcolumn", to="db.workspace")),
            ],
            options={"verbose_name": "Smart Column", "verbose_name_plural": "Smart Columns", "db_table": "smart_columns", "ordering": ["position", "created_at"]},
        ),
        migrations.CreateModel(
            name="SmartRow",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("cells", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(choices=[("draft", "draft"), ("committed", "committed")], db_index=True, default="committed", max_length=12)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smartrow_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smartrow", to="db.project")),
                ("source_issue", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smart_rows", to="db.issue")),
                ("table", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="rows", to="db.smarttable")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smartrow_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smartrow", to="db.workspace")),
            ],
            options={"verbose_name": "Smart Row", "verbose_name_plural": "Smart Rows", "db_table": "smart_rows", "ordering": ["position", "created_at"]},
        ),
        migrations.CreateModel(
            name="SmartTableIssueBinding",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("committed", models.BooleanField(default=False)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttableissuebinding_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("issue", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="smart_table_bindings", to="db.issue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smarttableissuebinding", to="db.project")),
                ("row", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="binding_of", to="db.smartrow")),
                ("table", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="issue_bindings", to="db.smarttable")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttableissuebinding_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smarttableissuebinding", to="db.workspace")),
            ],
            options={"verbose_name": "Smart Table Issue Binding", "verbose_name_plural": "Smart Table Issue Bindings", "db_table": "smart_table_issue_bindings"},
        ),
        migrations.AddIndex(model_name="smarttable", index=models.Index(fields=["project"], name="smart_tables_project_idx")),
        migrations.AddIndex(model_name="smartcolumn", index=models.Index(fields=["table", "position"], name="smart_cols_table_pos_idx")),
        migrations.AddIndex(model_name="smartrow", index=models.Index(fields=["table", "status"], name="smart_rows_table_status_idx")),
        migrations.AddIndex(model_name="smartrow", index=models.Index(fields=["source_issue"], name="smart_rows_src_issue_idx")),
        migrations.AddIndex(model_name="smarttableissuebinding", index=models.Index(fields=["issue"], name="smart_tib_issue_idx")),
        migrations.AddIndex(model_name="smarttableissuebinding", index=models.Index(fields=["table"], name="smart_tib_table_idx")),
    ]
