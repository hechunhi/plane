# BARSOUL: 0122 修补 — CommentTranslation 漏了 AuditModel(SoftDeleteModel)
# 自带的 deleted_at 列, ORM 查询时缺列导致 500。后追加。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0122_comment_translation"),
    ]

    operations = [
        migrations.AddField(
            model_name="commenttranslation",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="Deleted At"),
        ),
    ]
