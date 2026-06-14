# BARSOUL: 完整性 F-2 — SmartRow.incomplete(待补全标记). 见 docs/architecture/smart-table-mvp.md §10.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("db", "0133_smart_form")]

    operations = [
        migrations.AddField(
            model_name="smartrow",
            name="incomplete",
            field=models.BooleanField(default=False),
        ),
    ]
