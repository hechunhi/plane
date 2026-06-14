# BARSOUL: Blueprint 业务蓝图 B-1 — blueprints / blueprint_versions / blueprint_instances.
# 见 docs/architecture/blueprint-mvp.md。手写迁移(本仓约定:必含 deleted_at), 字段定义照 0130_smart_table。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0136_smart_table_user_view"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Blueprint",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                ("scope", models.CharField(choices=[("project", "project"), ("workspace", "workspace")], default="project", max_length=12)),
                ("permission", models.JSONField(blank=True, default=dict)),
                ("enabled", models.BooleanField(default=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="blueprint_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_blueprint", to="db.project")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="blueprint_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_blueprint", to="db.workspace")),
            ],
            options={"verbose_name": "Blueprint", "verbose_name_plural": "Blueprints", "db_table": "blueprints", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="BlueprintVersion",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("version", models.PositiveIntegerField()),
                ("definition", models.JSONField(blank=True, default=dict)),
                ("changelog", models.TextField(blank=True, default="")),
                ("published_at", models.DateTimeField(blank=True, null=True)),
                ("blueprint", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="versions", to="db.blueprint")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="blueprintversion_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_blueprintversion", to="db.project")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="blueprintversion_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_blueprintversion", to="db.workspace")),
            ],
            options={"verbose_name": "Blueprint Version", "verbose_name_plural": "Blueprint Versions", "db_table": "blueprint_versions", "ordering": ["-version"]},
        ),
        migrations.CreateModel(
            name="BlueprintInstance",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("status", models.CharField(choices=[("active", "active"), ("completed", "completed"), ("cancelled", "cancelled")], default="active", max_length=12)),
                ("created_refs", models.JSONField(blank=True, default=dict)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="blueprintinstance_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_blueprintinstance", to="db.project")),
                ("root_issue", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="blueprint_instances", to="db.issue")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="blueprintinstance_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("version", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="instances", to="db.blueprintversion")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_blueprintinstance", to="db.workspace")),
            ],
            options={"verbose_name": "Blueprint Instance", "verbose_name_plural": "Blueprint Instances", "db_table": "blueprint_instances"},
        ),
        migrations.AddIndex(model_name="blueprint", index=models.Index(fields=["project"], name="blueprints_project_idx")),
        migrations.AddIndex(model_name="blueprintversion", index=models.Index(fields=["blueprint", "version"], name="bp_versions_bp_ver_idx")),
        migrations.AddIndex(model_name="blueprintinstance", index=models.Index(fields=["version"], name="bp_instances_version_idx")),
        migrations.AddIndex(model_name="blueprintinstance", index=models.Index(fields=["root_issue"], name="bp_instances_root_issue_idx")),
    ]
