# BARSOUL: 视图配置持久化(按用户) — smart_table_user_views. 见 docs/architecture/smart-table-mvp.md §11.
# 手写迁移(本仓约定:必含 deleted_at), 字段定义照 0130_smart_table.
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0135_issue_keiri_facts"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SmartTableUserView",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("config", models.JSONField(blank=True, default=dict)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttableuserview_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smarttableuserview", to="db.project")),
                ("table", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="user_views", to="db.smarttable")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttableuserview_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="smart_table_views", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smarttableuserview", to="db.workspace")),
            ],
            options={"verbose_name": "Smart Table User View", "verbose_name_plural": "Smart Table User Views", "db_table": "smart_table_user_views"},
        ),
        migrations.AddIndex(model_name="smarttableuserview", index=models.Index(fields=["table", "user"], name="smart_tuv_table_user_idx")),
    ]
