# BARSOUL: 上游 v1.4.2 取り込み時のマージ migration。
# 上游 0122_alter_draftissue_assignees_... は M2M の through_fields 明示だけ(DB 変更なし)で、
# 当社の 0122_comment_translation 〜 0160 系列と並列の葉になったため、ここで 1 本に束ねる。

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0160_issue_comment_reply"),
        ("db", "0122_alter_draftissue_assignees_alter_issue_assignees_and_more"),
    ]

    operations = []
