# BARSOUL コメント返信 A 案 (hechun 2026-09-03): IssueComment.parent は上流に
# 既にあるが on_delete=CASCADE。Plane の削除は soft delete + 再帰カスケード
# (bgtasks/deletion_task.py) なので、親コメント 1 本の削除で他人の返信まで
# 巻き添えで消える。返信は発言者本人の SoR ゆえ SET_NULL へ変更する。
# 手書き移行(本リポ約定)。データ移行は不要 (FK の削除時挙動のみの変更)。
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0159_draft_issue_todo_tree"),
    ]

    operations = [
        migrations.AlterField(
            model_name="issuecomment",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="parent_issue_comment",
                to="db.issuecomment",
            ),
        ),
    ]
