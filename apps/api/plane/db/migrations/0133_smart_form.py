# BARSOUL: 表单对象化 F-1 — SmartForm + binding.form_id. 见 docs/architecture/smart-table-mvp.md §10.
# 手写迁移(本仓约定:必含 deleted_at). 与 smart_table.py 模型对齐, 字段定义照 0130_smart_table.
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0132_smarttable_shared_workspace"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SmartForm",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("fields", models.JSONField(blank=True, default=list)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smartform_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smartform", to="db.project")),
                ("table", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="forms", to="db.smarttable")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smartform_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smartform", to="db.workspace")),
            ],
            options={"verbose_name": "Smart Form", "verbose_name_plural": "Smart Forms", "db_table": "smart_forms", "ordering": ["position", "created_at"]},
        ),
        migrations.AddIndex(model_name="smartform", index=models.Index(fields=["table", "position"], name="smart_forms_table_pos_idx")),
        migrations.AddField(
            model_name="smarttableissuebinding",
            name="form",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="bindings", to="db.smartform"),
        ),
    ]
