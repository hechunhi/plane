# BARSOUL 2026-05-31 (hechun): 即点即译 内容ハッシュキャッシュ。
# override_text(tokenized) 経路で cache を効かせるため source_hash 追加。
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0123_comment_translation_soft_delete"),
    ]
    operations = [
        migrations.AddField(
            model_name="commenttranslation",
            name="source_hash",
            field=models.CharField(
                blank=True, db_index=True, default="", max_length=64
            ),
        ),
    ]
