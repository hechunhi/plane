# BARSOUL 2026-06-15 (hechun): リマインダー強化 — 旧スヌーズ(snoozed_until)に
# 「触发时刻 / 隐藏与否 / 强度 / 受众」を追加。存量 snooze 卡を新フィールドへ回填(=once/hide/self)。
from django.db import migrations, models


def backfill(apps, schema_editor):
    Issue = apps.get_model("db", "Issue")
    # 既存スヌーズ(snoozed_until 有) → remind_at=snoozed_until, hide=True, once, self
    # 历史模型无自定义 objects(管理器未 use_in_migrations) → 用 _default_manager
    Issue._default_manager.filter(snoozed_until__isnull=False).update(
        remind_at=models.F("snoozed_until"), remind_hide=True,
        remind_intensity="once", remind_audience="self")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [("db", "0146_smart_table_folder_acl")]

    operations = [
        migrations.AddField(model_name="issue", name="remind_at",
                            field=models.DateTimeField(blank=True, db_index=True, null=True)),
        migrations.AddField(model_name="issue", name="remind_hide",
                            field=models.BooleanField(default=False)),
        migrations.AddField(model_name="issue", name="remind_intensity",
                            field=models.CharField(default="once", max_length=8)),
        migrations.AddField(model_name="issue", name="remind_audience",
                            field=models.CharField(default="self", max_length=12)),
        migrations.AddField(model_name="issue", name="remind_note",
                            field=models.CharField(blank=True, default="", max_length=200)),
        migrations.AddField(model_name="issue", name="remind_fired_on",
                            field=models.DateField(blank=True, null=True)),
        migrations.RunPython(backfill, noop),
    ]
