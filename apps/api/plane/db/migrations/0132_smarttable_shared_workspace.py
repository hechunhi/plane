# BARSOUL: smart_table 加 shared_workspace(跨项目引用/护城河). 见 docs/architecture/smart-table-mvp.md §9 S-2.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("db", "0131_smartcolumn_width")]

    operations = [
        migrations.AddField(
            model_name="smarttable",
            name="shared_workspace",
            field=models.BooleanField(default=False),
        ),
    ]
