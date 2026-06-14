# BARSOUL B-4a(2026-06-10 专家批判会裁决「比价是数据问题不是卡片问题」):
# SmartRow.meta JSONB — 行级过程数据(candidates 候选行等), 与列值(cells)分离。
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0139_smart_table_shared_projects"),
    ]

    operations = [
        migrations.AddField(
            model_name="smartrow",
            name="meta",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
