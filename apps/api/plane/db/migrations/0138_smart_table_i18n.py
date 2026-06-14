# BARSOUL: schema i18n — 表/列/表单 显示层翻译 overlay(跨语言团队)。原名=键, 绝不因翻译改名。
# 见 docs/architecture/smart-table-mvp.md。
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("db", "0137_blueprint")]

    operations = [
        migrations.AddField(
            model_name="smarttable",
            name="i18n",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="smartcolumn",
            name="i18n",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="smartform",
            name="i18n",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
