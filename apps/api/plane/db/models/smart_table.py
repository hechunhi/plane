# BARSOUL: 智能表 / 项目数据库 (Smart Table). 见 docs/architecture/smart-table-mvp.md.
# 表=净新数据的家 + 各 SoR 的只读投影; manual 列值落 JSONB(cells).
# 闭环: 卡片「关联数据表」属性 → 卡内自动表单 → 写草稿行 → 卡完成 → 行 committed 进表.
# 绝不污染 SoR (Plane issue / keiri / approval): 投影列只读, 只有 manual 列由本表写.
from django.conf import settings
from django.db import models

from .project import ProjectBaseModel


class SmartTableFolder(ProjectBaseModel):
    """BARSOUL 2026-06-15: 数据表文件夹(纯组织层). project 内; 表的 folder 指向它。
    删文件夹→表 folder 置空(不删表)。仅组织/呈现, 不碰 SoR、不影响表自身共享。"""
    name = models.CharField(max_length=120)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Smart Table Folder"
        verbose_name_plural = "Smart Table Folders"
        db_table = "smart_table_folders"
        indexes = [models.Index(fields=["project"])]
        ordering = ["position", "created_at"]

    def __str__(self):
        return self.name


class SmartTable(ProjectBaseModel):
    """一张数据表(= Bitable 的一张表). project 内. schema 由 SmartColumn 运行时定义(B 路径)."""
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    # 文件夹(组织层, 可空=未归类)。删文件夹→SET_NULL。仅 home project 的列表分组用。
    folder = models.ForeignKey(
        SmartTableFolder, on_delete=models.SET_NULL, null=True, blank=True, related_name="tables")
    shared_workspace = models.BooleanField(default=False)  # 共享到全工作区 → 他 project 可引用(护城河)
    # 项目级精确共享: project id(str) 白名单, shared_workspace=False 时生效。
    # 动机: 工作区内可能有外部协作项目, 全工作区共享会泄露敏感表; 跨 workspace 由 slug 过滤天然隔离。
    shared_projects = models.JSONField(blank=True, default=list)
    i18n = models.JSONField(default=dict, blank=True)  # 显示层翻译 overlay {lang: {name}}; 原名=键(蓝图/反应按名引用), 绝不因翻译改名

    class Meta:
        verbose_name = "Smart Table"
        verbose_name_plural = "Smart Tables"
        db_table = "smart_tables"
        indexes = [models.Index(fields=["project"])]

    def __str__(self):
        return self.name


class SmartColumn(ProjectBaseModel):
    """一列. type=代码定义的有限调色板(用户选, 不造新类型). source=manual 可编辑落 cells;
    plane/keiri/ai_bot=只读投影(v1 仅 manual, 投影列后续切片)."""

    TYPE_CHOICES = [
        ("text", "text"),
        ("number", "number"),
        ("single_select", "single_select"),
        ("multi_select", "multi_select"),
        ("date", "date"),
        ("checkbox", "checkbox"),
    ]
    SOURCE_CHOICES = [
        ("manual", "manual"),
        ("plane", "plane"),
        ("keiri", "keiri"),
        ("ai_bot", "ai_bot"),
    ]

    table = models.ForeignKey(SmartTable, on_delete=models.CASCADE, related_name="columns")
    key = models.CharField(max_length=64)  # cells JSON 里的稳定 key
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="text")
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default="manual")
    options = models.JSONField(default=list, blank=True)   # single/multi_select: [{"v","color"}]
    binding = models.JSONField(default=dict, blank=True)   # 投影列: {plane_field|keiri|deriver}
    required = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(null=True, blank=True)  # 持久化列宽(px)
    i18n = models.JSONField(default=dict, blank=True)  # {lang: {name, options: {原值: 译文}}}; 选项译文仅显示用, cells 永远存原值
    # BARSOUL 2026-06-15 字段级权限(按 Plane 项目角色, 服务端强制): 最低角色阈值 int —
    # 0=不限(默认, 行为不变); 5=guest+ / 15=member+ / 20=仅 admin。view<阈值→该列隐藏(API 不返此 cell);
    # edit<阈值→该列对此人只读(写入被服务端丢弃)。绝不只靠前端藏列(假安全)。
    acl_view = models.PositiveSmallIntegerField(default=0)
    acl_edit = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "Smart Column"
        verbose_name_plural = "Smart Columns"
        db_table = "smart_columns"
        ordering = ["position", "created_at"]
        indexes = [models.Index(fields=["table", "position"])]

    def __str__(self):
        return f"{self.table_id}:{self.key}"


class SmartRow(ProjectBaseModel):
    """一行. manual 列值落 cells(JSONB). source_issue=由哪张卡产生(可空:也可直接表里建行).
    status: draft=卡未完成不进网格; committed=卡完成→进表(网格只展 committed)."""

    STATUS_CHOICES = [("draft", "draft"), ("committed", "committed")]

    table = models.ForeignKey(SmartTable, on_delete=models.CASCADE, related_name="rows")
    source_issue = models.ForeignKey(
        "db.Issue", null=True, blank=True, on_delete=models.SET_NULL, related_name="smart_rows"
    )
    cells = models.JSONField(default=dict, blank=True)  # {column_key: value}(manual 列)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="committed", db_index=True)
    position = models.PositiveIntegerField(default=0)
    incomplete = models.BooleanField(default=False)  # F-2: 卡完成入表时必填未补全 → 待补全标记(治理用, 不阻塞)
    # B-4a 候选行(2026-06-10 专家批判会裁决): 行级过程数据(非列值)。
    # meta.candidates = [{id, values:{col_key:val}, adopted, by, at}] — 比价等
    # "运行时份数"场景: 候选全集留痕(报价史=议价资产), 「采用」一份经
    # _coerce_cells 写 cells(主行)。比价是数据问题, 不是卡片问题。
    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Smart Row"
        verbose_name_plural = "Smart Rows"
        db_table = "smart_rows"
        ordering = ["position", "created_at"]
        indexes = [
            models.Index(fields=["table", "status"]),
            models.Index(fields=["source_issue"]),
        ]

    def __str__(self):
        return f"{self.table_id}:{self.id}"


class SmartForm(ProjectBaseModel):
    """表单 = 表的一个录入视图(F-1). fields=有序列子集 [{col(key), label(覆盖名), required(表单级)}].
    一表多表单(下单/发货/售后…); 视角改名靠 label; 卡片绑 form 而非整表."""

    table = models.ForeignKey(SmartTable, on_delete=models.CASCADE, related_name="forms")
    name = models.CharField(max_length=255)
    fields = models.JSONField(default=list, blank=True)  # [{"col": "<colkey>", "label": "", "required": false}]
    i18n = models.JSONField(default=dict, blank=True)  # {lang: {name, labels: {colkey: 译文}}}
    position = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Smart Form"
        verbose_name_plural = "Smart Forms"
        db_table = "smart_forms"
        ordering = ["position", "created_at"]
        indexes = [models.Index(fields=["table", "position"])]

    def __str__(self):
        return f"{self.table_id}:{self.name}"


class SmartTableIssueBinding(ProjectBaseModel):
    """卡片「关联数据表」属性. 一卡 ↔ 一表(可指定 form 录入视图), 持有一行草稿(row). 卡完成 → committed."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="smart_table_bindings")
    table = models.ForeignKey(SmartTable, on_delete=models.CASCADE, related_name="issue_bindings")
    form = models.ForeignKey(
        SmartForm, null=True, blank=True, on_delete=models.SET_NULL, related_name="bindings"
    )  # 绑定的录入表单(F-1); null=整表全字段(向后兼容)
    row = models.ForeignKey(
        SmartRow, null=True, blank=True, on_delete=models.SET_NULL, related_name="binding_of"
    )
    committed = models.BooleanField(default=False)  # 卡完成 → 草稿行已入表

    class Meta:
        verbose_name = "Smart Table Issue Binding"
        verbose_name_plural = "Smart Table Issue Bindings"
        db_table = "smart_table_issue_bindings"
        indexes = [models.Index(fields=["issue"]), models.Index(fields=["table"])]

    def __str__(self):
        return f"{self.issue_id}->{self.table_id}"


class SmartTableUserView(ProjectBaseModel):
    """每用户每表的视图配置(过滤/汇总/着色/行高 持久化). config=客户端拥有的 JSON, 后端只存取不解释.
    按用户隔离 — 同事的筛选互不影响(用户拍板: per-user 而非按表共享)."""

    table = models.ForeignKey(SmartTable, on_delete=models.CASCADE, related_name="user_views")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="smart_table_views")
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Smart Table User View"
        verbose_name_plural = "Smart Table User Views"
        db_table = "smart_table_user_views"
        indexes = [models.Index(fields=["table", "user"])]

    def __str__(self):
        return f"{self.table_id}:{self.user_id}"


class IssueKeiriFacts(ProjectBaseModel):
    """keiri 订单事实在 Plane 侧的只读投影 (F-4). ai-bot 当合法 writer 从 keiri 同步写入,
    smart-table keiri_* deriver 读时投影 (绝不写 keiri SoR). 仿 IssueAIState 模式."""

    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, related_name="keiri_facts")
    order_id = models.CharField(max_length=64, blank=True, default="")
    customer = models.CharField(max_length=255, blank=True, default="")
    jpy = models.FloatField(null=True, blank=True)
    cny = models.FloatField(null=True, blank=True)
    currency = models.CharField(max_length=8, blank=True, default="")
    freight = models.FloatField(null=True, blank=True)
    order_date = models.CharField(max_length=20, blank=True, default="")
    items_count = models.PositiveIntegerField(default=0)
    paid_amount = models.FloatField(null=True, blank=True)
    payment_count = models.PositiveIntegerField(default=0)
    synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Issue Keiri Facts"
        verbose_name_plural = "Issue Keiri Facts"
        db_table = "issue_keiri_facts"

    def __str__(self):
        return f"{self.issue_id}:{self.order_id}"
