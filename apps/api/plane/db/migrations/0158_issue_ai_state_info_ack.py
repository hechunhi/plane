# BARSOUL 2026-08-20: 「要補足(needs_info)」に人が打ち切れる出口を作る。
#
# これまで needs_info を消せるのは AI の再判断だけだった。人が補足しても AI が
# 納得しなければ立ち続ける ＝ 消せない指摘 ＝ 全員が無視するようになる。
# 「補足は不要」を人が確定できるようにして、留痕缺口を必ず閉じられる形にする。

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0157_web_push")]

    operations = [
        migrations.AddField(
            model_name="issueaistate",
            name="info_ack_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="issueaistate",
            name="info_ack_by",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
