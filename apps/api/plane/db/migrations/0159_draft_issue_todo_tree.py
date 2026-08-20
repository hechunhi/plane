# BARSOUL 2026-08: 個人 ToDo を「本物の ToDo リスト」にするための 3 列。
#   todo_parent — 1 段だけの子タスク(自己参照)。既存 `parent` は Issue を指す別物。
#   memo        — 自分だけの走り書き。`description_html` はチームに出す本文の下書き。
#   todo_order  — 個人の並び順。`sort_order` は save() が project+state 単位で
#                 書き換えるため使えない。既定 65535 → 既存行は従来通り時系列。
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0158_issue_ai_state_info_ack")]

    operations = [
        migrations.AddField(
            model_name="draftissue",
            name="todo_parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="todo_children",
                to="db.draftissue",
            ),
        ),
        migrations.AddField(
            model_name="draftissue",
            name="memo",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="draftissue",
            name="todo_order",
            field=models.FloatField(default=65535),
        ),
    ]
