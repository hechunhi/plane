# BARSOUL 2026-06-15 (hechun): 数据表 文件夹(组织层) + 字段级角色权限(acl_view/acl_edit)。
# 手写迁移(本仓约定: 必含 deleted_at), 字段照 0141_recurring_rule。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0145_issue_translation"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SmartTableFolder",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=120)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttablefolder_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_smarttablefolder", to="db.project")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="smarttablefolder_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_smarttablefolder", to="db.workspace")),
            ],
            options={
                "verbose_name": "Smart Table Folder",
                "verbose_name_plural": "Smart Table Folders",
                "db_table": "smart_table_folders",
                "ordering": ["position", "created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="smarttablefolder",
            index=models.Index(fields=["project"], name="smart_folder_project_idx"),
        ),
        migrations.AddField(
            model_name="smarttable",
            name="folder",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="tables", to="db.smarttablefolder"),
        ),
        migrations.AddField(
            model_name="smartcolumn",
            name="acl_view",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="smartcolumn",
            name="acl_edit",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
