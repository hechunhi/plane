# BARSOUL: 项目级精确共享 — shared_projects = project id 白名单(shared_workspace=False 时生效)。
# 动机: 工作区里可能有外部协作项目, 全工作区共享会把营收等敏感表泄露给外部成员。
# 见 docs/architecture/smart-table-mvp.md。
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("db", "0138_smart_table_i18n")]

    operations = [
        migrations.AddField(
            model_name="smarttable",
            name="shared_projects",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
