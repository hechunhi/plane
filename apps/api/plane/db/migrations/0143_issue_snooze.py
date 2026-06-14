# BARSOUL: フォローアップ・スヌーズ(Linear 风)— Issue に snoozed_until/snoozed_by 追加(nullable, 全存量卡不受影响)。
# 见 docs/architecture/recurring-tasks-mvp.md。issue_objects 管理器が snoozed_until>now を隠す → active 视图から消える。
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0142_recurring_overdue_push"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="snoozed_until",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="issue",
            name="snoozed_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="snoozed_issues", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddIndex(
            model_name="issue",
            index=models.Index(fields=["snoozed_until"], name="issues_snoozed_until_idx"),
        ),
    ]
