# BARSOUL: DIS 子树 rollup(父任务汇总子任务态)— IssueAIState 加 family 字段。
# 见 docs/architecture/derived-issue-state-mvp.md §子树。决策全 code, 叙述 gemma(schema 隔离)。
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0143_issue_snooze"),
    ]

    operations = [
        migrations.AddField(model_name="issueaistate", name="is_parent", field=models.BooleanField(db_index=True, default=False)),
        migrations.AddField(model_name="issueaistate", name="subtree_total", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="issueaistate", name="subtree_active", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="issueaistate", name="subtree_done", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="issueaistate", name="subtree_blocked", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="issueaistate", name="subtree_tension_zh", field=models.CharField(blank=True, default="", max_length=300)),
        migrations.AddField(model_name="issueaistate", name="subtree_tension_ja", field=models.CharField(blank=True, default="", max_length=300)),
        migrations.AddField(model_name="issueaistate", name="rep_child", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="db.issue")),
    ]
