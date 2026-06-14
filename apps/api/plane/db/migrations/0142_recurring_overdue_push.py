# BARSOUL: 定期タスク 逾期升级幂等字段(slice 3). 见 docs/architecture/recurring-tasks-mvp.md §5.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0141_recurring_rule"),
    ]

    operations = [
        migrations.AddField(
            model_name="recurringrule",
            name="overdue_pushed_issue",
            field=models.CharField(blank=True, default="", max_length=36),
        ),
    ]
