# BARSOUL: smart_column 加 width(持久化列宽). 见 docs/architecture/smart-table-mvp.md.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("db", "0130_smart_table")]

    operations = [
        migrations.AddField(
            model_name="smartcolumn",
            name="width",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
