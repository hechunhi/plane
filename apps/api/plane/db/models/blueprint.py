# BARSOUL: Blueprint(业务蓝图)— 声明式组合清单, 引用既有引擎(SmartTable/Form/reaction/Temporal/Lark)。
# 见 docs/architecture/blueprint-mvp.md。不是新引擎: 无状态机表/无脚本表/无字段ACL表(护栏)。
# 版本语义 copy-on-instantiate: 实例 FK 钉 version, 新版只影响之后的实例化。
from django.db import models

from .project import ProjectBaseModel


class Blueprint(ProjectBaseModel):
    SCOPE_CHOICES = [("project", "project"), ("workspace", "workspace")]

    name = models.CharField(max_length=255)  # slug(如 order-fulfillment)
    description = models.TextField(blank=True, default="")
    scope = models.CharField(max_length=12, choices=SCOPE_CHOICES, default="project")
    permission = models.JSONField(default=dict, blank=True)  # {use:[ROLE], edit:[ROLE]}
    enabled = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Blueprint"
        verbose_name_plural = "Blueprints"
        db_table = "blueprints"
        ordering = ["name"]
        indexes = [models.Index(fields=["project"])]

    def __str__(self):
        return self.name


class BlueprintVersion(ProjectBaseModel):
    """不可变定义快照。发布(published_at)后不改; 改=发新版。definition 格式见设计 §3。"""

    blueprint = models.ForeignKey(Blueprint, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    definition = models.JSONField(default=dict, blank=True)
    changelog = models.TextField(blank=True, default="")
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Blueprint Version"
        verbose_name_plural = "Blueprint Versions"
        db_table = "blueprint_versions"
        ordering = ["-version"]
        indexes = [models.Index(fields=["blueprint", "version"])]

    def __str__(self):
        return f"{self.blueprint_id}:v{self.version}"


class BlueprintInstance(ProjectBaseModel):
    """一次实例化的登记。FK 钉 version → 历史实例天然不受新版影响。created_refs=产物寻址。"""

    STATUS_CHOICES = [("active", "active"), ("completed", "completed"), ("cancelled", "cancelled")]

    version = models.ForeignKey(BlueprintVersion, on_delete=models.CASCADE, related_name="instances")
    root_issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="blueprint_instances")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="active")
    created_refs = models.JSONField(default=dict, blank=True)  # {issue,row,binding,workflow_id?}

    class Meta:
        verbose_name = "Blueprint Instance"
        verbose_name_plural = "Blueprint Instances"
        db_table = "blueprint_instances"
        indexes = [models.Index(fields=["version"]), models.Index(fields=["root_issue"])]

    def __str__(self):
        return f"{self.version_id}->{self.root_issue_id}"
