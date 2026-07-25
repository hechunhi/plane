# BARSOUL Inbox Phase3 (hechun 2026-07-07): 个人收件箱分流状态表 inbox_states。
# 「我的工作」digest の 完成/归档/Snooze/Pin/Mute 落点(per-user, per-issue 派生投影)。
# 手写迁移(本仓约定: 必含 deleted_at), 字段照 0146_smart_table_folder_acl。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0149_candidates_to_rows"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="InboxState",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("done_at", models.DateTimeField(blank=True, null=True)),
                ("archived_at", models.DateTimeField(blank=True, null=True)),
                ("snoozed_till", models.DateTimeField(blank=True, null=True)),
                ("pinned", models.BooleanField(default=False)),
                ("muted", models.BooleanField(default=False)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="inboxstate_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="inboxstate_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inbox_states", to="db.workspace")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inbox_states", to="db.project")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inbox_states", to=settings.AUTH_USER_MODEL)),
                ("issue", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inbox_states", to="db.issue")),
            ],
            options={
                "verbose_name": "Inbox State",
                "verbose_name_plural": "Inbox States",
                "db_table": "inbox_states",
                "ordering": ("-updated_at",),
                "unique_together": {("user", "issue")},
            },
        ),
        migrations.AddIndex(
            model_name="inboxstate",
            index=models.Index(fields=["user", "workspace"], name="inbox_user_ws_idx"),
        ),
    ]
