# BARSOUL: DIS v2 — 富派生字段(actor person/external、等待对象、源评论、双语、unassigned)。
# 详 docs/architecture/derived-issue-state-mvp.md。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0125_issue_ai_state"),
    ]

    operations = [
        # 当前行动人 person/external + Plane member id(person→头像)
        migrations.AddField(model_name="issueaistate", name="actor_kind",
            field=models.CharField(blank=True, default="", max_length=8)),  # person|external|""
        migrations.AddField(model_name="issueaistate", name="actor_user_id",
            field=models.UUIDField(blank=True, null=True)),
        # 等待对象(ball=OTHER 时),双语
        migrations.AddField(model_name="issueaistate", name="waiting_on_zh",
            field=models.CharField(blank=True, default="", max_length=160)),
        migrations.AddField(model_name="issueaistate", name="waiting_on_ja",
            field=models.CharField(blank=True, default="", max_length=160)),
        # next_action(既存=zh)+ ja;reasoning(既存=zh)+ ja
        migrations.AddField(model_name="issueaistate", name="next_action_ja",
            field=models.CharField(blank=True, default="", max_length=160)),
        migrations.AddField(model_name="issueaistate", name="reasoning_ja",
            field=models.TextField(blank=True, default="")),
        # 推断依据:源评论作者 + 原文引用(原语言)
        migrations.AddField(model_name="issueaistate", name="source_author",
            field=models.CharField(blank=True, default="", max_length=120)),
        migrations.AddField(model_name="issueaistate", name="source_quote",
            field=models.CharField(blank=True, default="", max_length=400)),
        # ball=SELF 但无负责人
        migrations.AddField(model_name="issueaistate", name="unassigned",
            field=models.BooleanField(default=False)),
    ]
