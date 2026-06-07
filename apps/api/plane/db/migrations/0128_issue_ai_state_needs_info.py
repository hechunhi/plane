# BARSOUL DIS v10: 信息完整性/留痕缺口 字段。
# needs_info=状态与材料明显矛盾或材料不足以解释当前状态 → 要求人补充(留痕)。
# AddField(非 CreateModel)→ 无需 deleted_at(那是 AuditModel 建表时的坑)。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0127_issue_ai_state_human_correction"),
    ]

    operations = [
        migrations.AddField(
            model_name="issueaistate",
            name="needs_info",
            field=models.BooleanField(default=False, db_index=True),
        ),
        migrations.AddField(
            model_name="issueaistate",
            name="info_gap_zh",
            field=models.CharField(blank=True, default="", max_length=300),
        ),
        migrations.AddField(
            model_name="issueaistate",
            name="info_gap_ja",
            field=models.CharField(blank=True, default="", max_length=300),
        ),
    ]
