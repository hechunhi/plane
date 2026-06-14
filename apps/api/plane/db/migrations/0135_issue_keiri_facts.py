# BARSOUL: F-4 keiri 投影 — issue_keiri_facts (ai-bot 从 keiri 同步, smart-table 读时投影).
# 见 docs/architecture/smart-table-mvp.md §10. 手写迁移, 字段定义照 0130_smart_table.
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0134_smartrow_incomplete"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="IssueKeiriFacts",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("order_id", models.CharField(blank=True, default="", max_length=64)),
                ("customer", models.CharField(blank=True, default="", max_length=255)),
                ("jpy", models.FloatField(blank=True, null=True)),
                ("cny", models.FloatField(blank=True, null=True)),
                ("currency", models.CharField(blank=True, default="", max_length=8)),
                ("freight", models.FloatField(blank=True, null=True)),
                ("order_date", models.CharField(blank=True, default="", max_length=20)),
                ("items_count", models.PositiveIntegerField(default=0)),
                ("paid_amount", models.FloatField(blank=True, null=True)),
                ("payment_count", models.PositiveIntegerField(default=0)),
                ("synced_at", models.DateTimeField(blank=True, null=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issuekeirifacts_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("issue", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="keiri_facts", to="db.issue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_issuekeirifacts", to="db.project")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="issuekeirifacts_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_issuekeirifacts", to="db.workspace")),
            ],
            options={"verbose_name": "Issue Keiri Facts", "verbose_name_plural": "Issue Keiri Facts", "db_table": "issue_keiri_facts"},
        ),
    ]
