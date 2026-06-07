# BARSOUL DIS v12: 补充框架 字段。
# needs_info 时,AI 结合本卡情况给一个「补充框架」(AI 理解 + 待澄清点),
# 让补充人一眼知道该写什么,按补充人语言展示。AddField → 无需 deleted_at。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0128_issue_ai_state_needs_info"),
    ]

    operations = [
        migrations.AddField(
            model_name="issueaistate",
            name="info_framework_zh",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="issueaistate",
            name="info_framework_ja",
            field=models.TextField(blank=True, default=""),
        ),
    ]
