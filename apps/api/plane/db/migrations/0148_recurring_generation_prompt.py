# BARSOUL 2026-06-16 (hechun): 定期タスク再生成 — 以「上一张生成的卡」为基 + 此提示词
# 走 ai-bot /transform LLM 改写出新卡正文(结构保持)。空=原样克隆基底(旧行为不变)。
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("db", "0147_issue_reminder")]

    operations = [
        migrations.AddField(
            model_name="recurringrule",
            name="generation_prompt",
            field=models.TextField(blank=True, default=""),
        ),
    ]
