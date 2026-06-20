# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# BARSOUL: 智能表 / 项目数据库 REST API. 见 docs/architecture/smart-table-mvp.md.
# 闭环: 表/列/行 CRUD + 卡片「关联数据表」自动表单 + 草稿行 + 卡完成→committed 进表.
# 绝不写 Plane/keiri/approval SoR; 只写 smart_* 自有表(净新数据). 投影列(plane/keiri/ai_bot)只读.
import json
import logging
import os
import uuid

import requests

from django.utils import timezone
from django.db.models import Q

from rest_framework.response import Response
from rest_framework import status

from plane.app.views.base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import (
    Issue,
    IssueAIState,
    IssueKeiriFacts,
    Project,
    SmartColumn,
    SmartForm,
    SmartRow,
    SmartTable,
    SmartTableFolder,
    SmartTableIssueBinding,
    SmartTableUserView,
)
from plane.db.models import ProjectMember

logger = logging.getLogger(__name__)

_COMPLETED_GROUPS = ("completed", "cancelled")
_VALID_TYPES = {"text", "number", "single_select", "multi_select", "date", "checkbox", "url", "image", "money", "rating", "progress", "range", "sparkline", "user"}


# ── hand-built JSON (同 DIS 风格, 不上 DRF serializer) ──
# ── 字段级角色权限(服务端强制): acl_view/acl_edit = 最低角色阈值 int(0=不限) ──
def _can_view(c, role):
    return not c.acl_view or (role or 0) >= c.acl_view

def _can_edit(c, role):
    return c.source == "manual" and (not c.acl_edit or (role or 0) >= c.acl_edit)


def _col(c, role=None):
    return {
        "id": str(c.id), "key": c.key, "name": c.name, "type": c.type,
        "source": c.source, "options": c.options or [],
        "required": bool(c.required), "position": c.position, "width": c.width,
        "deriver": (c.binding or {}).get("deriver"),
        "i18n": c.i18n or {},
        "acl_view": int(c.acl_view or 0), "acl_edit": int(c.acl_edit or 0),
        # 此阅览者能否编辑(manual 且角色达标)。role=None → 兼容旧调用(=manual 即可编辑)。
        "editable": (c.source == "manual") if role is None else _can_edit(c, role),
    }


def _row(r):
    return {
        "id": str(r.id), "cells": r.cells or {}, "status": r.status,
        "source_issue": str(r.source_issue_id) if r.source_issue_id else None,
        "source_issue_project": str(r.source_issue.project_id) if r.source_issue_id else None,
        "position": r.position,
        "incomplete": bool(r.incomplete),
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _columns_of(table):
    return [_col(c) for c in SmartColumn.objects.filter(table=table).order_by("position", "created_at")]


def _form(f):
    return {"id": str(f.id), "name": f.name, "fields": f.fields or [], "position": f.position, "i18n": f.i18n or {}}


def _form_fields(form, columns, role=None):
    """form.fields → 列样式 dict(给卡内表单渲染): 子集 + 有序 + label 覆盖名 + 表单级 required。
    role 给定时按字段级权限隐藏不可见列 + 标注 editable。"""
    by_key = {c.key: c for c in columns}
    out = []
    for fld in (form.fields or []):
        c = by_key.get(fld.get("col"))
        if not c:
            continue
        if role is not None and not _can_view(c, role):
            continue  # 隐藏列: 表单里也不出现
        d = _col(c, role)
        if fld.get("label"):
            d["name"] = fld["label"]
            # 别名的译文(form.i18n.labels)盖到 i18n.name 槽 → 前端统一按 i18n 解析显示
            fi = form.i18n or {}
            merged = dict(d.get("i18n") or {})
            for lg, slot in fi.items():
                tr = ((slot or {}).get("labels") or {}).get(fld.get("col"))
                if tr:
                    ms = dict(merged.get(lg) or {})
                    ms["name"] = tr
                    merged[lg] = ms
            d["i18n"] = merged
        if "required" in fld:
            d["required"] = bool(fld["required"])
        out.append(d)
    return out


def _is_empty(v):
    return v is None or v == "" or (isinstance(v, list) and len(v) == 0)


def _required_keys(binding):
    """绑定的必填字段 key: 有 form 用表单字段级必填; 否则用表的必填 manual 列(F-2)."""
    if binding.form_id and binding.form:
        return [f.get("col") for f in (binding.form.fields or []) if f.get("required") and f.get("col")]
    return list(SmartColumn.objects.filter(table_id=binding.table_id, source="manual", required=True).values_list("key", flat=True))


def _commit_completed(table=None, issue_id=None):
    """惰性提交: 卡「已完成/取消」→ 其草稿行转 committed(进表). 幂等.
    在读表/读绑定时调用 → 无需 Issue 热路径 signal. 绝不写 SoR(只动 smart_* 自有表).
    F-2: 入表时按绑定表单的必填算 incomplete 标记(治理用, 不阻塞卡片完成)."""
    qs = SmartTableIssueBinding.objects.filter(committed=False).select_related("issue__state", "form")
    if table is not None:
        qs = qs.filter(table=table)
    if issue_id is not None:
        qs = qs.filter(issue_id=issue_id)
    for b in qs:
        st = getattr(b.issue, "state", None)
        if st and st.group in _COMPLETED_GROUPS:
            if b.row_id:
                row = SmartRow.objects.filter(pk=b.row_id, status="draft").first()
                if row:
                    req = _required_keys(b)
                    cells = row.cells or {}
                    row.status = "committed"
                    row.incomplete = any(_is_empty(cells.get(k)) for k in req)
                    row.save(update_fields=["status", "incomplete", "updated_at"])
            # Option A: commit any extra rows for this issue/table (candidates promoted to rows)
            SmartRow.objects.filter(
                source_issue_id=b.issue_id, table_id=b.table_id, status="draft", deleted_at__isnull=True,
            ).exclude(pk=b.row_id).update(status="committed", updated_at=timezone.now())
            b.committed = True
            b.save(update_fields=["committed", "updated_at"])


def _ws_id(slug, project_id):
    return Project.objects.values_list("workspace_id", flat=True).get(pk=project_id, workspace__slug=slug)


def _accessible_table(slug, project_id, table_id):
    """当前 project 自有表, 或同 workspace 内共享给它的他项目表(全工作区 或 项目白名单).
    跨项目读写都先经此 → 防 IDOR(只凭 table_id 越权他项目数据); slug 过滤 → 跨 workspace 天然隔离."""
    return SmartTable.objects.get(
        Q(project_id=project_id) | Q(shared_workspace=True) | Q(shared_projects__contains=[str(project_id)]),
        pk=table_id, workspace__slug=slug,
    )


def _coerce_cells(columns, cells, role=None):
    """只接受 manual 列的 key; 投影列(plane/keiri/ai_bot)只读, 丢弃前端误传。
    role 给定时再按字段级权限丢弃此人无编辑权的列(服务端强制, 不信前端隐藏)。"""
    allowed = {c.key for c in columns
               if c.source == "manual" and (role is None or _can_edit(c, role))}
    return {k: v for k, v in (cells or {}).items() if k in allowed}


def _viewer_role(slug, project_id, user):
    """阅览者在当前 project 的角色 int(ADMIN=20/MEMBER=15/GUEST=5; 非成员=0)。字段级权限按此判定。"""
    if not user or not getattr(user, "is_authenticated", False):
        return 0
    return ProjectMember.objects.filter(
        workspace__slug=slug, project_id=project_id, member=user, is_active=True
    ).values_list("role", flat=True).first() or 0


def _table_deps(t):
    """删除/取消共享前的依赖盘点(显式、可见、不静默): 行/表单/用户视图/卡绑定(含外项目)/蓝图按名引用.
    蓝图引用是名字耦合(blueprint-mvp.md §3), 删表会让其发布校验与实例化报错 → 必须呈给人看."""
    import json as _json

    from plane.db.models import BlueprintVersion

    binds = SmartTableIssueBinding.objects.filter(table=t).select_related("issue")
    total = binds.count()
    foreign = binds.exclude(project_id=t.project_id).count()
    cards = [b.issue.name[:60] for b in binds.order_by("-created_at")[:5]]
    bp_refs, seen = [], set()
    for v in BlueprintVersion.objects.select_related("blueprint", "project").order_by("-created_at")[:200]:
        if t.name in _json.dumps(v.definition or {}, ensure_ascii=False):
            if str(v.blueprint_id) in seen:
                continue
            seen.add(str(v.blueprint_id))
            bp_refs.append({"name": v.blueprint.name, "version": v.version,
                            "project": v.project.name, "foreign": str(v.project_id) != str(t.project_id)})
    return {
        "rows": SmartRow.objects.filter(table=t).count(),
        "forms": SmartForm.objects.filter(table=t).count(),
        "views": SmartTableUserView.objects.filter(table=t).count(),
        "bindings": {"total": total, "foreign": foreign, "cards": cards},
        "blueprints": bp_refs,
    }


# ── 派生/投影列(读时计算, 绝不写): 从 row.source_issue 投影 Plane Issue + ai-bot 的 issue_ai_states ──
# deriver 算法全在代码里(护栏: 不是用户自定义字段类型, 是代码定义的有限投影集). issue_ai_states 由 ai-bot
# derive_issue_state 维护 → 这里只读其产出, 不新增写路径.
_DERIVERS = {
    "issue_status":   {"source": "plane",  "type": "text",   "zh": "状态(卡片)",   "ja": "ステータス"},
    "issue_assignee": {"source": "plane",  "type": "text",   "zh": "负责人(卡片)", "ja": "担当者"},
    "issue_stale":    {"source": "ai_bot", "type": "number", "zh": "停滞天数(AI)", "ja": "停滞日数(AI)"},
    "issue_next":     {"source": "ai_bot", "type": "text",   "zh": "下一步(AI)",   "ja": "次アクション(AI)"},
    # F-4: keiri 订单投影(读 issue_keiri_facts, ai-bot 同步; 绝不写 keiri SoR)
    "keiri_amount":     {"source": "keiri", "type": "money",    "zh": "订单金额",      "ja": "注文金額"},
    "keiri_paid":       {"source": "keiri", "type": "checkbox", "zh": "已收款",        "ja": "入金済"},
    "keiri_items":      {"source": "keiri", "type": "number",   "zh": "品目数",        "ja": "品目数"},
    "keiri_freight":    {"source": "keiri", "type": "money",    "zh": "运费",          "ja": "送料"},
    "keiri_customer":   {"source": "keiri", "type": "text",     "zh": "客户(keiri)",   "ja": "顧客(keiri)"},
    "keiri_order_date": {"source": "keiri", "type": "date",     "zh": "下单日(keiri)", "ja": "注文日(keiri)"},
}


def _derive_value(deriver, iss, ai, kf, now):
    if deriver == "keiri_amount":
        return kf.jpy if kf else None
    if deriver == "keiri_paid":
        return ((kf.paid_amount or 0) >= kf.jpy) if (kf and kf.jpy is not None) else None
    if deriver == "keiri_items":
        return kf.items_count if kf else None
    if deriver == "keiri_freight":
        return kf.freight if kf else None
    if deriver == "keiri_customer":
        return (kf.customer or None) if kf else None
    if deriver == "keiri_order_date":
        return (kf.order_date or None) if kf else None
    if iss is None:
        return None
    if deriver == "issue_status":
        return iss.state.name if iss.state_id else None
    if deriver == "issue_assignee":
        names = []
        for u in iss.assignees.all():
            nm = (u.display_name or "").strip() or (u.first_name + " " + u.last_name).strip()
            if nm and nm not in names:  # 去重(M2M 可能返回重复 assignee)
                names.append(nm)
        return ", ".join(names) or None
    if deriver == "issue_stale":
        if ai is not None and ai.stale_days is not None:
            return ai.stale_days
        return (now - iss.updated_at).days if iss.updated_at else None
    if deriver == "issue_next":
        if ai is not None:
            return ai.next_action or ai.next_action_ja or None
        return None
    return None


def _project_rows(rows, columns, now):
    """派生列(source!=manual 且 binding.deriver∈_DERIVERS)的值读时算出, 合并进各 row 内存 cells.
    批量取 Issue + IssueAIState 防 N+1. 纯读: 不 save, 不碰任何 SoR."""
    derived = [c for c in columns if c.source != "manual" and isinstance(c.binding, dict) and c.binding.get("deriver") in _DERIVERS]
    if not derived:
        return
    issue_ids = [r.source_issue_id for r in rows if r.source_issue_id]
    issues, ai_map, kf_map = {}, {}, {}
    if issue_ids:
        issues = {str(i.id): i for i in Issue.objects.filter(id__in=issue_ids).select_related("state").prefetch_related("assignees")}
        ai_map = {str(a.issue_id): a for a in IssueAIState.objects.filter(issue_id__in=issue_ids)}
        kf_map = {str(k.issue_id): k for k in IssueKeiriFacts.objects.filter(issue_id__in=issue_ids)}
    for r in rows:
        iid = str(r.source_issue_id) if r.source_issue_id else None
        iss = issues.get(iid) if iid else None
        ai = ai_map.get(iid) if iid else None
        kf = kf_map.get(iid) if iid else None
        cells = dict(r.cells or {})
        for c in derived:
            cells[c.key] = _derive_value(c.binding.get("deriver"), iss, ai, kf, now)
        r.cells = cells


class SmartTableListEndpoint(BaseAPIView):
    """GET/POST /workspaces/{slug}/projects/{pid}/smart-tables/"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        tables = (SmartTable.objects.filter(workspace__slug=slug)
                  .filter(Q(project_id=project_id) | Q(shared_workspace=True)
                          | Q(shared_projects__contains=[str(project_id)]))
                  .order_by("-created_at"))
        out = [{
            "id": str(t.id), "name": t.name, "description": t.description,
            "column_count": SmartColumn.objects.filter(table=t).count(),
            "row_count": SmartRow.objects.filter(table=t, status="committed").count(),
            "i18n": t.i18n or {},
            "shared_workspace": bool(t.shared_workspace),
            "shared_projects": list(t.shared_projects or []),
            "foreign": str(t.project_id) != str(project_id),
            # 文件夹归属仅 home project 有意义(外项目共享表在本项目列表里视为未归类)
            "folder": str(t.folder_id) if (t.folder_id and str(t.project_id) == str(project_id)) else None,
        } for t in tables]
        return Response(out, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        name = ((request.data or {}).get("name") or "").strip()[:255]
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        uid = request.user.id if request.user.is_authenticated else None
        t = SmartTable.objects.create(
            name=name, description=((request.data or {}).get("description") or "")[:2000],
            project_id=project_id, workspace_id=_ws_id(slug, project_id),
            created_by_id=uid, updated_by_id=uid)
        return Response({"id": str(t.id), "name": t.name, "description": t.description,
                         "columns": [], "rows": []}, status=status.HTTP_201_CREATED)


class SmartTableFolderEndpoint(BaseAPIView):
    """数据表文件夹(组织层). GET/POST .../smart-table-folders/  |  PATCH/DELETE .../smart-table-folders/{fid}/
    纯组织: 删文件夹只把表 folder 置空(SET_NULL), 不删表; 不碰 SoR、不影响表共享。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        fs = SmartTableFolder.objects.filter(workspace__slug=slug, project_id=project_id).order_by("position", "created_at")
        return Response([{"id": str(f.id), "name": f.name, "position": f.position} for f in fs], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        name = ((request.data or {}).get("name") or "").strip()[:120]
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        uid = request.user.id if request.user.is_authenticated else None
        last = SmartTableFolder.objects.filter(project_id=project_id).count()
        f = SmartTableFolder.objects.create(
            name=name, position=last, project_id=project_id, workspace_id=_ws_id(slug, project_id),
            created_by_id=uid, updated_by_id=uid)
        return Response({"id": str(f.id), "name": f.name, "position": f.position}, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, folder_id):
        try:
            f = SmartTableFolder.objects.get(pk=folder_id, workspace__slug=slug, project_id=project_id)
        except SmartTableFolder.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        if d.get("name"):
            f.name = d["name"].strip()[:120]
        if isinstance(d.get("position"), int):
            f.position = d["position"]
        f.updated_by_id = request.user.id if request.user.is_authenticated else None
        f.save()
        return Response({"id": str(f.id), "name": f.name, "position": f.position}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, folder_id):
        try:
            f = SmartTableFolder.objects.get(pk=folder_id, workspace__slug=slug, project_id=project_id)
        except SmartTableFolder.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        # 表 folder 置空(组内表回到「未归类」), 再软删文件夹 — 绝不删表
        SmartTable.objects.filter(folder_id=folder_id).update(folder=None)
        f.deleted_at = timezone.now()
        f.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class SmartTableDetailEndpoint(BaseAPIView):
    """GET/PATCH/DELETE /workspaces/{slug}/projects/{pid}/smart-tables/{tid}/ — GET 返列+committed 行(网格用)"""

    def _get(self, slug, project_id, table_id):
        return _accessible_table(slug, project_id, table_id)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, table_id):
        try:
            t = self._get(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        _commit_completed(table=t)
        role = _viewer_role(slug, project_id, request.user)
        cols = [c for c in SmartColumn.objects.filter(table=t).order_by("position", "created_at") if _can_view(c, role)]
        vkeys = {c.key for c in cols}  # 隐藏列的 cell 绝不出服务端
        rows = list(SmartRow.objects.filter(table=t, status="committed").select_related("source_issue").order_by("position", "created_at"))
        _project_rows(rows, cols, timezone.now())  # 只投影可见列
        out_rows = []
        for r in rows:
            rr = _row(r)
            rr["cells"] = {k: v for k, v in (rr["cells"] or {}).items() if k in vkeys}
            out_rows.append(rr)
        return Response({
            "id": str(t.id), "name": t.name, "description": t.description,
            "shared_workspace": bool(t.shared_workspace),
            "shared_projects": list(t.shared_projects or []),
            "foreign": str(t.project_id) != str(project_id),
            "i18n": t.i18n or {},
            "columns": [_col(c, role) for c in cols], "rows": out_rows,
        }, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, table_id):
        try:
            t = self._get(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        if d.get("name"):
            t.name = d["name"].strip()[:255]
        if "description" in d:
            t.description = (d["description"] or "")[:2000]
        if isinstance(d.get("i18n"), dict):
            t.i18n = d["i18n"]
        if "folder_id" in d and str(t.project_id) == str(project_id):
            # 归入文件夹 / 移出(null)。文件夹须同项目, 否则忽略(防越权挂他项目文件夹)。
            fid = d.get("folder_id")
            if fid:
                ok = SmartTableFolder.objects.filter(pk=fid, project_id=project_id).exists()
                t.folder_id = fid if ok else t.folder_id
            else:
                t.folder = None
        if ("shared_workspace" in d or "shared_projects" in d) and str(t.project_id) == str(project_id):
            # 仅 home project 可改共享。范围 = 全工作区(shared_workspace) 或 项目白名单(shared_projects)。
            want_ws = bool(d.get("shared_workspace", t.shared_workspace))
            if "shared_projects" in d:
                raw = d.get("shared_projects") or []
                if not isinstance(raw, list):
                    raw = []
                valid = {str(p) for p in Project.objects.filter(
                    workspace__slug=slug, pk__in=[x for x in raw if x]).values_list("id", flat=True)}
                want_pids = [str(x) for x in raw if str(x) in valid and str(x) != str(t.project_id)]
            else:
                want_pids = list(t.shared_projects or [])
            # 收窄检测: 失去访问的外项目仍有卡绑定/蓝图引用 → 409 要人确认(祖父化: 既有绑定
            # 仍可经卡片表单写, 但表不可见/不可再新绑; 蓝图实例化将报错), 绝不静默断
            if not want_ws and not d.get("confirm_unshare"):
                before_all, before_pids = bool(t.shared_workspace), set(t.shared_projects or [])
                after_pids = set(want_pids)

                def _had(pid):
                    return before_all or pid in before_pids

                bind_pids = {str(x) for x in SmartTableIssueBinding.objects.filter(table=t)
                             .exclude(project_id=t.project_id).values_list("project_id", flat=True)}
                losing_binds = {p for p in bind_pids if _had(p) and p not in after_pids}
                import json as _json

                from plane.db.models import BlueprintVersion
                losing_bps, seen = [], set()
                for v in BlueprintVersion.objects.select_related("blueprint", "project").order_by("-created_at")[:200]:
                    pid = str(v.project_id)
                    if pid == str(t.project_id) or str(v.blueprint_id) in seen:
                        continue
                    if _had(pid) and pid not in after_pids and t.name in _json.dumps(v.definition or {}, ensure_ascii=False):
                        seen.add(str(v.blueprint_id))
                        losing_bps.append({"name": v.blueprint.name, "version": v.version,
                                           "project": v.project.name, "foreign": True})
                if losing_binds or losing_bps:
                    n_bind = SmartTableIssueBinding.objects.filter(
                        table=t, project_id__in=list(losing_binds)).count()
                    return Response({
                        "error": "unshare_blocked",
                        "deps": {"foreign_bindings": n_bind, "blueprints": losing_bps},
                    }, status=status.HTTP_409_CONFLICT)
            t.shared_workspace = want_ws
            t.shared_projects = want_pids
        t.updated_by_id = request.user.id if request.user.is_authenticated else None
        t.save()
        return Response({"id": str(t.id), "name": t.name, "description": t.description,
                         "shared_workspace": bool(t.shared_workspace),
                         "shared_projects": list(t.shared_projects or [])}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        if str(t.project_id) != str(project_id):  # 引用方不可删他项目的共享表
            return Response({"error": "only home project can delete a shared table"}, status=status.HTTP_403_FORBIDDEN)
        deps = _table_deps(t)
        # 有卡绑定/蓝图引用时必须显式 force(前端已展示依赖并二次确认) — API 层防误删兜底
        if (deps["bindings"]["total"] or deps["blueprints"]) and request.GET.get("force") != "true":
            return Response({"error": "has_dependencies", "deps": deps}, status=status.HTTP_409_CONFLICT)
        now = timezone.now()
        SmartColumn.objects.filter(table_id=table_id).update(deleted_at=now)
        SmartRow.objects.filter(table_id=table_id).update(deleted_at=now)
        SmartForm.objects.filter(table_id=table_id).update(deleted_at=now)
        SmartTableUserView.objects.filter(table_id=table_id).update(deleted_at=now)
        # 卡侧绑定一并软删 → 卡片表单回到「未关联」, 不留幽灵绑定(指向已删表)
        SmartTableIssueBinding.objects.filter(table_id=table_id).update(deleted_at=now)
        SmartTable.objects.filter(pk=table_id).update(deleted_at=now)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SmartColumnEndpoint(BaseAPIView):
    """POST .../smart-tables/{tid}/columns/  |  PATCH/DELETE .../columns/{cid}/  (运行时自定义 schema = B 路径)"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "table not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        uid = request.user.id if request.user.is_authenticated else None
        last = SmartColumn.objects.filter(table=t).count()
        deriver = d.get("deriver")
        if deriver:  # 派生/投影列 — source/type 由代码定义的 deriver 决定(护栏: 不是用户造类型)
            if deriver not in _DERIVERS:
                return Response({"error": "invalid deriver"}, status=status.HTTP_400_BAD_REQUEST)
            spec = _DERIVERS[deriver]
            base = f"d_{deriver}"
            key = base
            n = 1
            while SmartColumn.objects.filter(table=t, key=key).exists():
                n += 1
                key = f"{base}_{n}"
            name = ((d.get("name") or spec["zh"]).strip() or spec["zh"])[:255]
            c = SmartColumn.objects.create(
                table=t, key=key, name=name, type=spec["type"], source=spec["source"],
                options=[], binding={"deriver": deriver}, required=False, position=last,
                project_id=t.project_id, workspace_id=t.workspace_id, created_by_id=uid, updated_by_id=uid)
            return Response(_col(c), status=status.HTTP_201_CREATED)
        name = (d.get("name") or "").strip()[:255]
        ctype = d.get("type") or "text"
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        if ctype not in _VALID_TYPES:
            return Response({"error": "invalid type"}, status=status.HTTP_400_BAD_REQUEST)
        key = (d.get("key") or "").strip()[:64] or f"c{SmartColumn.objects.filter(table=t).count() + 1}"
        c = SmartColumn.objects.create(
            table=t, key=key, name=name, type=ctype, source="manual",
            options=d.get("options") or [], required=bool(d.get("required")),
            position=d.get("position") if isinstance(d.get("position"), int) else last,
            project_id=t.project_id, workspace_id=t.workspace_id, created_by_id=uid, updated_by_id=uid)
        return Response(_col(c), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, table_id, column_id):
        try:
            _accessible_table(slug, project_id, table_id)
            c = SmartColumn.objects.get(pk=column_id, table_id=table_id)
        except (SmartTable.DoesNotExist, SmartColumn.DoesNotExist):
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        if d.get("name"):
            c.name = d["name"].strip()[:255]
        if d.get("type") in _VALID_TYPES:
            c.type = d["type"]
        if "options" in d:
            c.options = d.get("options") or []
        if "required" in d:
            c.required = bool(d.get("required"))
        if isinstance(d.get("position"), int):
            c.position = d["position"]
        if isinstance(d.get("width"), int):
            c.width = d["width"]
        if isinstance(d.get("i18n"), dict):
            c.i18n = d["i18n"]
        # 字段级权限阈值(0/5/15/20)。仅接受合法档位。
        for fld in ("acl_view", "acl_edit"):
            if fld in d:
                v = d.get(fld)
                if v in (0, 5, 15, 20):
                    setattr(c, fld, v)
        c.updated_by_id = request.user.id if request.user.is_authenticated else None
        c.save()
        return Response(_col(c), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, table_id, column_id):
        try:
            _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        SmartColumn.objects.filter(pk=column_id, table_id=table_id).update(deleted_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class SmartRowEndpoint(BaseAPIView):
    """POST .../smart-tables/{tid}/rows/  |  PATCH/DELETE .../rows/{rid}/  (直接在表里增改删行)"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "table not found"}, status=status.HTTP_404_NOT_FOUND)
        uid = request.user.id if request.user.is_authenticated else None
        role = _viewer_role(slug, project_id, request.user)
        cells = _coerce_cells(SmartColumn.objects.filter(table=t), (request.data or {}).get("cells"), role)
        r = SmartRow.objects.create(
            table=t, cells=cells, status="committed",
            position=SmartRow.objects.filter(table=t).count(),
            project_id=t.project_id, workspace_id=t.workspace_id, created_by_id=uid, updated_by_id=uid)
        return Response(_row(r), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, table_id, row_id):
        try:
            _accessible_table(slug, project_id, table_id)
            r = SmartRow.objects.select_related("table").get(pk=row_id, table_id=table_id)
        except (SmartTable.DoesNotExist, SmartRow.DoesNotExist):
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        body = request.data or {}
        role = _viewer_role(slug, project_id, request.user)
        patch = _coerce_cells(SmartColumn.objects.filter(table_id=table_id), body.get("cells"), role)
        merged = dict(r.cells or {})
        merged.update(patch)
        r.cells = merged
        fields = ["cells", "updated_by", "updated_at"]
        if isinstance(body.get("position"), int):
            r.position = body["position"]
            fields.append("position")
        r.updated_by_id = request.user.id if request.user.is_authenticated else None
        r.save(update_fields=fields)
        return Response(_row(r), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, table_id, row_id):
        try:
            _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        SmartRow.objects.filter(pk=row_id, table_id=table_id).update(deleted_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class SmartFormEndpoint(BaseAPIView):
    """表单(录入视图)CRUD. GET/POST .../smart-tables/{tid}/forms/  |  PATCH/DELETE .../forms/{fid}/"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, table_id):
        try:
            _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        forms = SmartForm.objects.filter(table_id=table_id).order_by("position", "created_at")
        # 表单↔卡片可视化: 每表单带使用卡数 + 样例卡(前端可点击跳转)
        binds = (
            SmartTableIssueBinding.objects.filter(table_id=table_id, form_id__isnull=False)
            .select_related("issue")
            .order_by("-created_at")
        )
        by_form = {}
        for b in binds:
            by_form.setdefault(str(b.form_id), []).append(b)
        out = []
        for f in forms:
            d = _form(f)
            fb = by_form.get(str(f.id), [])
            d["binding_count"] = len(fb)
            d["bound_cards"] = [
                {
                    "issue": str(b.issue_id),
                    "project": str(b.issue.project_id),
                    "seq": b.issue.sequence_id,
                    "name": b.issue.name,
                }
                for b in fb[:8]
            ]
            out.append(d)
        return Response(out, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        name = (d.get("name") or "").strip()[:255]
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        uid = request.user.id if request.user.is_authenticated else None
        last = SmartForm.objects.filter(table=t).count()
        f = SmartForm.objects.create(
            table=t, name=name, fields=d.get("fields") if isinstance(d.get("fields"), list) else [],
            position=last, project_id=t.project_id, workspace_id=t.workspace_id,
            created_by_id=uid, updated_by_id=uid)
        return Response(_form(f), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, table_id, form_id):
        try:
            _accessible_table(slug, project_id, table_id)
            f = SmartForm.objects.get(pk=form_id, table_id=table_id)
        except (SmartTable.DoesNotExist, SmartForm.DoesNotExist):
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        if d.get("name"):
            f.name = d["name"].strip()[:255]
        if isinstance(d.get("fields"), list):
            f.fields = d["fields"]
        if isinstance(d.get("position"), int):
            f.position = d["position"]
        if isinstance(d.get("i18n"), dict):
            f.i18n = d["i18n"]
        f.updated_by_id = request.user.id if request.user.is_authenticated else None
        f.save()
        return Response(_form(f), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, table_id, form_id):
        try:
            _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        SmartForm.objects.filter(pk=form_id, table_id=table_id).update(deleted_at=timezone.now())
        SmartTableIssueBinding.objects.filter(form_id=form_id).update(form=None)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _gateway_translate_batch(terms, target):
    """schema 术语批量翻译 → 对齐的 list[str|None]。走 LLM gateway(即点即译同管线=爱酱通道);
    整批一次 chat 调用, JSON 数组进出; 任何异常=全 None(失败不写)。"""
    url = os.environ.get("LLM_GATEWAY_URL", "").strip()
    if not url or not terms:
        return [None] * len(terms)
    lang_name = {"ja": "日本語", "zh": "简体中文", "en": "English"}.get(target, target)
    sys = (
        "你是跨境电商企业 BARSOUL(大阪, 中日团队)的业务助理。下面是项目管理数据表的 schema 术语"
        "(表名/列名/选项值/表单名), 多为中文或日文短语。\n"
        f"任务: 把每一项翻译成{lang_name}。规则:\n"
        f"1. 若某项已经是{lang_name}, 原样返回该项。\n"
        "2. 保持术语简短、业务化(这是表头/选项, 不是句子)。数字、英文代号、符号原样保留。\n"
        "3. 只输出一个 JSON 字符串数组, 长度与输入数组完全相同, 顺序一一对应。不要输出任何其他文字。"
    )
    payload = {
        "model": os.environ.get("LLM_AUGMENT_MODEL", "gemma-4-12b").strip(),
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(terms, ensure_ascii=False)},
        ],
        "temperature": 0.1,
        "max_tokens": 4096,
    }
    try:
        r = requests.post(url, json=payload, timeout=90)
        if r.status_code != 200:
            return [None] * len(terms)
        out = (((r.json().get("choices") or [{}])[0] or {}).get("message", {}) or {}).get("content", "") or ""
        s, e = out.find("["), out.rfind("]")
        arr = json.loads(out[s:e + 1]) if 0 <= s < e else []
        if not isinstance(arr, list) or len(arr) != len(terms):
            return [None] * len(terms)
        return [str(x).strip() if x else None for x in arr]
    except Exception:
        logger.exception("schema translate gateway failed")
        return [None] * len(terms)


class SmartTableTranslateEndpoint(BaseAPIView):
    """POST .../smart-tables/{tid}/translate/ — 爱酱一键翻译 schema(表名/列名/选项/表单名/字段别名)。
    默认只填空槽(保护用户手改的译文), body {overwrite:true} 覆盖; {targets:["ja","zh","en"]} 选语言。
    译文=显示层 overlay; 原名与选项原值(=数据键)绝不改。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        body = request.data or {}
        targets = [x for x in (body.get("targets") or ["zh", "ja"]) if x in ("zh", "ja", "en")]
        overwrite = bool(body.get("overwrite"))
        cols = list(SmartColumn.objects.filter(table=t))
        forms = list(SmartForm.objects.filter(table=t))
        entries = [("table", t, "name", t.name)]
        for c in cols:
            entries.append(("col_name", c, "name", c.name))
            if c.type in ("single_select", "multi_select"):
                for o in (c.options or []):
                    if o.get("v"):
                        entries.append(("col_opt", c, o["v"], o["v"]))
        for f in forms:
            entries.append(("form_name", f, "name", f.name))
            for fl in (f.fields or []):
                if fl.get("label"):
                    entries.append(("form_label", f, fl["col"], fl["label"]))
        terms = [e[3] for e in entries]
        filled = {}
        for tg in targets:
            idxs = []
            for i, (kind, obj, key, _src) in enumerate(entries):
                cur = (obj.i18n or {}).get(tg) or {}
                if kind in ("table", "col_name", "form_name"):
                    has = bool(cur.get("name"))
                elif kind == "col_opt":
                    has = bool((cur.get("options") or {}).get(key))
                else:
                    has = bool((cur.get("labels") or {}).get(key))
                if overwrite or not has:
                    idxs.append(i)
            filled[tg] = 0
            if not idxs:
                continue
            outs = _gateway_translate_batch([terms[i] for i in idxs], tg)
            for j, i in enumerate(idxs):
                tr = outs[j]
                if not tr:
                    continue
                kind, obj, key, _src = entries[i]
                m = dict(obj.i18n or {})
                slot = dict(m.get(tg) or {})
                if kind in ("table", "col_name", "form_name"):
                    slot["name"] = tr
                elif kind == "col_opt":
                    op = dict(slot.get("options") or {})
                    op[key] = tr
                    slot["options"] = op
                else:
                    lb = dict(slot.get("labels") or {})
                    lb[key] = tr
                    slot["labels"] = lb
                m[tg] = slot
                obj.i18n = m
                filled[tg] += 1
        t.save(update_fields=["i18n", "updated_at"])
        for c in cols:
            c.save(update_fields=["i18n", "updated_at"])
        for f in forms:
            f.save(update_fields=["i18n", "updated_at"])
        return Response({"filled": filled, "terms": len(terms)}, status=status.HTTP_200_OK)


class SmartTableDepsEndpoint(BaseAPIView):
    """GET .../smart-tables/{tid}/deps/ — 删除/取消共享前的依赖报告(行/表单/视图/卡绑定/蓝图引用)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(_table_deps(t), status=status.HTTP_200_OK)


class SmartTableMyViewEndpoint(BaseAPIView):
    """每用户视图配置(过滤/汇总/着色/行高 持久化). GET/PUT .../smart-tables/{tid}/my-view/
    config 整存整取(客户端拥有 schema, 后端不解释). 按用户隔离."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, table_id):
        try:
            _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        v = SmartTableUserView.objects.filter(table_id=table_id, user=request.user).first()
        return Response({"config": (v.config if v else {}) or {}}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def put(self, request, slug, project_id, table_id):
        try:
            t = _accessible_table(slug, project_id, table_id)
        except SmartTable.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        cfg = (request.data or {}).get("config")
        if not isinstance(cfg, dict):
            return Response({"error": "config (object) required"}, status=status.HTTP_400_BAD_REQUEST)
        v = SmartTableUserView.objects.filter(table_id=table_id, user=request.user).first()
        if v:
            v.config = cfg
            v.updated_by_id = request.user.id
            v.save(update_fields=["config", "updated_by", "updated_at"])
        else:
            v = SmartTableUserView.objects.create(
                table_id=table_id, user=request.user, config=cfg,
                project_id=t.project_id, workspace_id=t.workspace_id,
                created_by_id=request.user.id, updated_by_id=request.user.id)
        return Response({"config": v.config}, status=status.HTTP_200_OK)


class IssueSmartTableBindingEndpoint(BaseAPIView):
    """卡片「关联数据表」+ 卡内自动表单.
    GET    .../issues/{iid}/smart-table-binding/   → {bound, table, columns, row} (渲染卡内表单)
    PUT    body {table_id}                         → 绑定 + 建草稿行(替换旧绑定)
    PATCH  body {cells}                            → 表单实时保存到草稿行
    DELETE                                         → 解绑(软删草稿行 + binding)
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        _commit_completed(issue_id=issue_id)
        b = (SmartTableIssueBinding.objects
             .filter(issue_id=issue_id, project_id=project_id)
             .select_related("table", "form", "row").first())
        if not b:
            return Response({"bound": False}, status=status.HTTP_200_OK)
        role = _viewer_role(slug, project_id, request.user)
        cols = list(SmartColumn.objects.filter(table_id=b.table_id).order_by("position", "created_at"))
        columns = _form_fields(b.form, cols, role) if b.form_id else [_col(c, role) for c in cols if _can_view(c, role)]
        vkeys = {c["key"] for c in columns}
        row_out = _row(b.row) if b.row_id else {"cells": {}}
        row_out["cells"] = {k: v for k, v in (row_out.get("cells") or {}).items() if k in vkeys}
        # Option A: issue's extra rows (candidates promoted) — exclude the binding's main row
        issue_rows_qs = (SmartRow.objects
                         .filter(source_issue_id=issue_id, table_id=b.table_id)
                         .order_by("position", "created_at"))
        if b.row_id:
            issue_rows_qs = issue_rows_qs.exclude(pk=b.row_id)
        rows_out = []
        for r in issue_rows_qs:
            ro = _row(r)
            ro["cells"] = {k: v for k, v in (ro.get("cells") or {}).items() if k in vkeys}
            rows_out.append(ro)
        return Response({
            "bound": True, "committed": bool(b.committed),
            "table": {"id": str(b.table_id), "name": b.table.name, "i18n": b.table.i18n or {}},
            "form": {"id": str(b.form_id), "name": b.form.name, "i18n": b.form.i18n or {}} if b.form_id else None,
            "columns": columns,
            "row": row_out,
            "rows": rows_out,
        }, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def put(self, request, slug, project_id, issue_id):
        body = request.data or {}
        form_id, table_id, row_id = body.get("form_id"), body.get("table_id"), body.get("row_id")
        try:
            issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
            if form_id:  # 绑表单(F-1): 表单自带它属于哪张表
                form = SmartForm.objects.get(pk=form_id)
                table = _accessible_table(slug, project_id, str(form.table_id))
            elif table_id:  # 绑整表(向后兼容)
                table = _accessible_table(slug, project_id, table_id)
                form = None
            else:
                return Response({"error": "table_id or form_id required"}, status=status.HTTP_400_BAD_REQUEST)
            target_row = SmartRow.objects.get(pk=row_id, table_id=table.id) if row_id else None  # F-3: 绑已存在行(订单台账串联)
        except (Issue.DoesNotExist, SmartTable.DoesNotExist, SmartForm.DoesNotExist, SmartRow.DoesNotExist):
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        uid = request.user.id if request.user.is_authenticated else None
        now = timezone.now()
        existing = SmartTableIssueBinding.objects.filter(issue=issue).select_related("row").first()
        if existing and str(existing.table_id) == str(table.id):
            b = existing  # 同表: 切表单视图 / 切目标行(同表 cells 复用, 不丢草稿)
            fields = []
            if str(b.form_id or "") != str(form.id if form else ""):
                b.form = form
                fields.append("form")
            if target_row and str(b.row_id or "") != str(target_row.id):
                if b.row_id and b.row and b.row.status == "draft":  # 弃用本绑定建的旧草稿
                    SmartRow.objects.filter(pk=b.row_id, status="draft").update(deleted_at=now)
                b.row = target_row
                b.committed = target_row.status == "committed"
                fields += ["row", "committed"]
            if fields:
                b.updated_by_id = uid
                b.save(update_fields=fields + ["updated_by", "updated_at"])
        else:
            if existing:  # 换表 → 软删旧绑定的草稿行(committed 行留作历史)
                if existing.row_id:
                    SmartRow.objects.filter(pk=existing.row_id, status="draft").update(deleted_at=now)
                existing.deleted_at = now
                existing.save(update_fields=["deleted_at"])
            if target_row:  # 绑到已有行: 卡变成该行某列片的录入口(订单台账)
                row, committed = target_row, target_row.status == "committed"
            else:
                row = SmartRow.objects.create(
                    table=table, source_issue=issue, status="draft", cells={}, position=0,
                    project_id=project_id, workspace_id=issue.workspace_id, created_by_id=uid, updated_by_id=uid)
                committed = False
            b = SmartTableIssueBinding.objects.create(
                issue=issue, table=table, form=form, row=row, committed=committed,
                project_id=project_id, workspace_id=issue.workspace_id, created_by_id=uid, updated_by_id=uid)
        role = _viewer_role(slug, project_id, request.user)
        cols = list(SmartColumn.objects.filter(table_id=table.id).order_by("position", "created_at"))
        columns = _form_fields(form, cols, role) if form else [_col(c, role) for c in cols if _can_view(c, role)]
        vkeys = {c["key"] for c in columns}
        row_out = _row(b.row) if b.row_id else {"cells": {}}
        row_out["cells"] = {k: v for k, v in (row_out.get("cells") or {}).items() if k in vkeys}
        return Response({
            "bound": True, "committed": bool(b.committed),
            "table": {"id": str(table.id), "name": table.name, "i18n": table.i18n or {}},
            "form": {"id": str(form.id), "name": form.name, "i18n": form.i18n or {}} if form else None,
            "columns": columns,
            "row": row_out,
        }, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id):
        b = (SmartTableIssueBinding.objects
             .filter(issue_id=issue_id, project_id=project_id).select_related("row").first())
        if not b or not b.row_id:
            return Response({"error": "no binding"}, status=status.HTTP_404_NOT_FOUND)
        role = _viewer_role(slug, project_id, request.user)
        patch = _coerce_cells(SmartColumn.objects.filter(table_id=b.table_id), (request.data or {}).get("cells"), role)
        merged = dict(b.row.cells or {})
        merged.update(patch)
        b.row.cells = merged
        b.row.updated_by_id = request.user.id if request.user.is_authenticated else None
        b.row.save(update_fields=["cells", "updated_by", "updated_at"])
        return Response(_row(b.row), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, issue_id):
        now = timezone.now()
        for b in SmartTableIssueBinding.objects.filter(issue_id=issue_id, project_id=project_id):
            if b.row_id:
                SmartRow.objects.filter(pk=b.row_id, status="draft").update(deleted_at=now)
            b.deleted_at = now
            b.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueSmartBindingCandidatesEndpoint(BaseAPIView):
    """Option A: 候选行已提升为独立 SmartRow (2026-06-19).
    POST .../issues/{iid}/smart-table-binding/candidates/
      {action: "upsert", candidate: {id?, values:{col_key:val}}}  → 增/改一行(committed)
      {action: "delete", id}                                       → 软删一行
    committed 后冻结。返回 {rows}(前端原地刷新)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        b = (SmartTableIssueBinding.objects
             .filter(issue_id=issue_id, project_id=project_id)
             .select_related("row", "table", "form").first())
        if not b:
            return Response({"error": "no binding"}, status=status.HTTP_404_NOT_FOUND)
        if b.committed:
            return Response({"error": "committed, rows frozen"}, status=status.HTTP_409_CONFLICT)
        d = request.data or {}
        action = (d.get("action") or "").strip()
        cols = SmartColumn.objects.filter(table_id=b.table_id)
        role = _viewer_role(slug, project_id, request.user)
        uid = request.user.id if request.user.is_authenticated else None
        now = timezone.now()

        if action == "upsert":
            cand = d.get("candidate") or {}
            values = _coerce_cells(cols, cand.get("values") or {}, role)
            cid = (cand.get("id") or "").strip()
            if cid:
                # update existing row (must belong to this issue/table)
                SmartRow.objects.filter(
                    pk=cid, source_issue_id=issue_id, table_id=b.table_id, deleted_at__isnull=True,
                ).update(cells=values, updated_by_id=uid, updated_at=now)
            else:
                SmartRow.objects.create(
                    table_id=b.table_id, source_issue_id=issue_id,
                    cells=values, status="committed", position=0, meta={},
                    project_id=project_id, workspace_id=b.workspace_id,
                    created_by_id=uid, updated_by_id=uid,
                )
        elif action == "delete":
            cid = (d.get("id") or "").strip()
            SmartRow.objects.filter(
                pk=cid, source_issue_id=issue_id, table_id=b.table_id,
            ).update(deleted_at=now, updated_at=now)
        else:
            return Response({"error": "action must be upsert|delete"}, status=status.HTTP_400_BAD_REQUEST)

        # Rebuild rows list (exclude main binding row)
        cols_list = list(SmartColumn.objects.filter(table_id=b.table_id).order_by("position", "created_at"))
        columns = _form_fields(b.form, cols_list, role) if b.form_id else [_col(c, role) for c in cols_list if _can_view(c, role)]
        vkeys = {c["key"] for c in columns}
        issue_rows_qs = (SmartRow.objects
                         .filter(source_issue_id=issue_id, table_id=b.table_id)
                         .order_by("position", "created_at"))
        if b.row_id:
            issue_rows_qs = issue_rows_qs.exclude(pk=b.row_id)
        rows_out = []
        for r in issue_rows_qs:
            ro = _row(r)
            ro["cells"] = {k: v for k, v in (ro.get("cells") or {}).items() if k in vkeys}
            rows_out.append(ro)
        return Response({"rows": rows_out}, status=status.HTTP_200_OK)


class IssueSmartSubtreeRowsEndpoint(BaseAPIView):
    """GET /issues/{iid}/smart-subtree-rows/ — B-4c(用户终验: 「在一个任务里
    看到所有子任务状态, 不然一堆子任务会失控」): 总卡上一屏汇总**子树全部台账行**。
    子树 = 自身 + 后代(≤3 层); 行 = SmartRow.source_issue ∈ 子树, 按表分组;
    列裁剪 = 该组任一行有值的列(空列不占宽)。只读视图, 行尾带来源卡(前端跳 peek)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        ids = [issue_id]
        frontier = [issue_id]
        for _ in range(3):
            kids = list(Issue.objects.filter(parent_id__in=frontier).values_list("id", flat=True))
            if not kids:
                break
            ids += kids
            frontier = kids
        rows = (SmartRow.objects
                .filter(source_issue_id__in=ids, table__workspace__slug=slug)
                .select_related("table", "source_issue")
                .order_by("table_id", "position"))
        groups: dict = {}
        for r in rows:
            g = groups.setdefault(str(r.table_id), {
                "table": {"id": str(r.table_id), "name": r.table.name, "i18n": r.table.i18n or {}},
                "rows": [],
            })
            g["rows"].append({
                "id": str(r.id), "cells": r.cells or {}, "status": r.status,
                "source": {
                    "id": str(r.source_issue_id),
                    "sequence_id": r.source_issue.sequence_id,
                    "project": str(r.source_issue.project_id),
                    "name": r.source_issue.name,
                },
            })
        role = _viewer_role(slug, project_id, request.user)
        out = []
        for tid, g in groups.items():
            cols = [c for c in SmartColumn.objects.filter(table_id=tid).order_by("position") if _can_view(c, role)]
            used = [c for c in cols
                    if any((row["cells"].get(c.key) not in (None, "", []))
                           for row in g["rows"])]
            vkeys = {c.key for c in used}
            for row in g["rows"]:  # 隐藏列的 cell 绝不出服务端
                row["cells"] = {k: v for k, v in (row["cells"] or {}).items() if k in vkeys}
            out.append({"table": g["table"], "columns": [_col(c, role) for c in used], "rows": g["rows"]})
        return Response({"groups": out}, status=status.HTTP_200_OK)
