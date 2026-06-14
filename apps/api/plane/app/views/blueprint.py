# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# BARSOUL: Blueprint(业务蓝图)REST API — B-1 实例化。见 docs/architecture/blueprint-mvp.md。
# 实例化是产品自身行为(用户=操作者, RBAC 守门), 非 agent 写 SoR; 涉流程(dag)走既有内部代理→ai-bot→Temporal(B-3)。
import logging
import os

import requests

from django.db import transaction
from django.db.models import Q

from rest_framework.response import Response
from rest_framework import status

from plane.app.views.base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import (
    Blueprint,
    BlueprintInstance,
    BlueprintVersion,
    Issue,
    IssueLabel,
    Label,
    SmartColumn,
    SmartForm,
    SmartRow,
    SmartTable,
    SmartTableIssueBinding,
)

logger = logging.getLogger(__name__)

# B-3c: dag → 既有内部信任通道(同 issue/comment.py 审批代理)→ ai-bot 薄转发 → Temporal
_AIBOT_BASE = os.environ.get("AIBOT_URL", "http://host.docker.internal:8098").rstrip("/")
_CARDS_TOKEN = os.environ.get("CARDS_INTERNAL_TOKEN", "").strip()


def _bp(b, latest):
    return {
        "id": str(b.id), "name": b.name, "description": b.description,
        "scope": b.scope, "enabled": bool(b.enabled),
        "title": ((latest.definition or {}).get("title") if latest else None) or b.name,
        "latest_version": latest.version if latest else None,
    }


def _latest_published(b):
    return BlueprintVersion.objects.filter(blueprint=b, published_at__isnull=False).order_by("-version").first()


def _resolve(defn, slug, project_id):
    """名字引用 → 对象(蓝图的「编译」)。失败收集人话报错, 不半成品落地."""
    errors, out = [], {"table": None, "form": None, "labels": []}
    inst = defn.get("instantiate") or {}
    row = inst.get("row") or {}
    tname = row.get("table")
    if tname:
        table = SmartTable.objects.filter(
            Q(project_id=project_id) | Q(shared_workspace=True), workspace__slug=slug, name=tname
        ).first()
        if not table:
            errors.append(f"table '{tname}' not found")
        out["table"] = table
        fname = row.get("form")
        if fname and table:
            form = SmartForm.objects.filter(table=table, name=fname).first()
            if not form:
                errors.append(f"form '{fname}' not found in table '{tname}'")
            out["form"] = form
    label_names = (inst.get("card") or {}).get("labels") or []
    labels = list(Label.objects.filter(project_id=project_id, name__in=label_names))
    for missing in set(label_names) - {lb.name for lb in labels}:
        errors.append(f"label '{missing}' not in this project (Plane 标签项目级)")
    out["labels"] = labels

    # B-2b(2026-06-10): dag 任务静态校验 — 此前只校验 instantiate 节, dag 的
    # bind 错名要到运行时(bind_table 活动重试耗尽)才爆。发布即编译, 全在这查。
    tasks = (defn.get("dag") or {}).get("tasks") or []
    keys = [(t.get("key") or "").strip() for t in tasks]
    for k in {k for k in keys if k and keys.count(k) > 1}:
        errors.append(f"dag: task key '{k}' 重复")
    if any(not k for k in keys):
        errors.append("dag: 有 task 缺 key")
    kset = set(keys)
    for t in tasks:
        tk = (t.get("key") or "?").strip()
        for dep in t.get("after") or []:
            if dep not in kset:
                errors.append(f"dag[{tk}]: after '{dep}' 不是已定义的 task key")
        ap = t.get("approval")
        if not (t.get("card") or "").strip() and ap is None:
            errors.append(f"dag[{tk}]: 既无卡名也非审批节点")
        if ap is not None and not (ap.get("approvers") or []):
            errors.append(f"dag[{tk}]: 审批节点没有审批人")
        b = t.get("bind") or {}
        if b.get("table"):
            bt = SmartTable.objects.filter(
                Q(project_id=project_id) | Q(shared_workspace=True),
                workspace__slug=slug, name=b["table"]).first()
            if not bt:
                errors.append(f"dag[{tk}]: 表 '{b['table']}' not found")
            elif b.get("form") and not SmartForm.objects.filter(table=bt, name=b["form"]).exists():
                errors.append(f"dag[{tk}]: form '{b['form']}' not found in table '{b['table']}'")
    if any(t.get("assignees") for t in tasks):  # B-2d: 站点担当须是在册项目成员
        from plane.db.models import ProjectMember

        mids = {str(x) for x in ProjectMember.objects.filter(
            project_id=project_id, is_active=True).values_list("member_id", flat=True)}
        for t in tasks:
            for aid in t.get("assignees") or []:
                if str(aid) not in mids:
                    errors.append(f"dag[{(t.get('key') or '?').strip()}]: 担当 '{aid}' 不是本项目成员")
    if tasks and kset and all(keys):  # 环检测(Kahn; key 缺/重时跳过避免误报)
        indeg = {k: 0 for k in kset}
        adj = {k: [] for k in kset}
        for t in tasks:
            for dep in t.get("after") or []:
                if dep in kset:
                    adj[dep].append(t["key"])
                    indeg[t["key"]] += 1
        q = [k for k, v in indeg.items() if v == 0]
        seen = 0
        while q:
            k = q.pop()
            seen += 1
            for nx in adj[k]:
                indeg[nx] -= 1
                if indeg[nx] == 0:
                    q.append(nx)
        if seen != len(kset):
            errors.append("dag: 依赖成环(after 链有循环)")
    return out, errors


def instantiate_blueprint(version, *, slug, project_id, workspace_id, user, title, customer="", seed_cells=None,
                          parent_issue=None):
    """事务实例化: 卡 + 标签 + 台账行(draft) + 表单绑定 + 实例登记(version 钉死)。返回 (result, errors).
    B-2l: parent_issue 指定时根卡挂为该卡子卡(「从需求卡发起流程」— 需求卡→流程根卡→站卡 三层)。"""
    defn = version.definition or {}
    resolved, errors = _resolve(defn, slug, project_id)
    if errors:
        return None, errors
    warnings = []
    inst = defn.get("instantiate") or {}
    tmpl = (inst.get("card") or {}).get("name_template") or "{title}"
    card_name = (tmpl.replace("{customer}", customer or "").replace("{title}", title)).strip() or title
    uid = user.id if user and user.is_authenticated else None
    with transaction.atomic():
        issue = Issue.objects.create(
            project_id=project_id, workspace_id=workspace_id, name=card_name[:255],
            parent_id=parent_issue or None,
            created_by_id=uid, updated_by_id=uid)
        for lb in resolved["labels"]:
            IssueLabel.objects.create(
                issue=issue, label=lb, project_id=project_id, workspace_id=workspace_id,
                created_by_id=uid, updated_by_id=uid)
        refs = {"issue": str(issue.id)}
        table, form = resolved["table"], resolved["form"]
        if table:
            cells = {}
            if isinstance(seed_cells, dict):
                from plane.app.views.smart_table import _coerce_cells
                cells = _coerce_cells(SmartColumn.objects.filter(table=table), seed_cells)
            row = SmartRow.objects.create(
                table=table, source_issue=issue, cells=cells, status="draft",
                position=SmartRow.objects.filter(table=table).count(),
                project_id=table.project_id, workspace_id=table.workspace_id,
                created_by_id=uid, updated_by_id=uid)
            binding = SmartTableIssueBinding.objects.create(
                issue=issue, table=table, form=form, row=row,
                project_id=project_id, workspace_id=workspace_id,
                created_by_id=uid, updated_by_id=uid)
            refs["row"] = str(row.id)
            refs["binding"] = str(binding.id)
            # B-2l 续: 从需求卡发起时, 需求卡也绑同一行(form=None=整表视角) —
            # 「这单生意的总卡」上看完整一行数据, 各站填写逐步充实(用户预期)。
            if parent_issue:
                SmartTableIssueBinding.objects.get_or_create(
                    issue_id=parent_issue, table=table,
                    defaults=dict(form=None, row=row,
                                  project_id=project_id, workspace_id=workspace_id,
                                  created_by_id=uid, updated_by_id=uid))
        bi = BlueprintInstance.objects.create(
            version=version, root_issue=issue, status="active", created_refs=refs,
            project_id=project_id, workspace_id=workspace_id, created_by_id=uid, updated_by_id=uid)
    # dag → Temporal(事务提交后才投递, 防 DB 回滚留孤儿 workflow; 失败降级为 warning, 实例本体已成立)
    dag = defn.get("dag") or {}
    if isinstance(dag.get("tasks"), list) and dag["tasks"]:
        workflow_id = f"bp-{bi.id}"
        payload = {
            "id": workflow_id, "title": title, "workspaceSlug": slug,
            "project": str(project_id), "rootIssue": str(issue.id),
            "rowId": refs.get("row") or "", "tasks": dag["tasks"],
        }
        try:
            if not _CARDS_TOKEN:
                raise RuntimeError("CARDS_INTERNAL_TOKEN unset")
            r = requests.post(f"{_AIBOT_BASE}/blueprint/start-dag", json=payload,
                              headers={"X-Cards-Token": _CARDS_TOKEN}, timeout=15)
            if r.status_code == 200 and (r.json() or {}).get("ok"):
                refs["workflow_id"] = workflow_id
                bi.created_refs = refs
                bi.save(update_fields=["created_refs", "updated_at"])
            else:
                warnings.append(f"dag start failed: http {r.status_code} {r.text[:120]}")
        except Exception as e:
            logger.exception("blueprint dag start failed (instance kept)")
            warnings.append(f"dag start failed: {e}")
    return {
        "instance_id": str(bi.id), "issue_id": str(issue.id),
        "sequence_id": issue.sequence_id, "blueprint_version": version.version,
        "refs": refs, "warnings": warnings,
    }, None


def _draft(b):
    return BlueprintVersion.objects.filter(blueprint=b, published_at__isnull=True).order_by("-version").first()


def _editor_refs(slug, project_id):
    """编辑器下拉用的可引用对象(引用项不给自由文本, 见设计 §6)."""
    from plane.db.models import ProjectMember

    tables = SmartTable.objects.filter(
        Q(project_id=project_id) | Q(shared_workspace=True), workspace__slug=slug
    ).order_by("name")
    return {
        "tables": [
            {"name": t.name, "forms": list(SmartForm.objects.filter(table=t).order_by("position").values_list("name", flat=True))}
            for t in tables
        ],
        "labels": list(Label.objects.filter(project_id=project_id).order_by("name").values_list("name", flat=True)),
        # B-2b DAG 编辑器: 审批节点 approvers 成员下拉(id+显示名; bot 号不进审批)
        "members": [
            {"id": str(m.member_id), "name": m.member.display_name or m.member.email}
            for m in ProjectMember.objects.filter(
                project_id=project_id, is_active=True, member__is_bot=False)
            .select_related("member").order_by("member__display_name")
        ],
    }


class BlueprintListEndpoint(BaseAPIView):
    """GET 列表(本项目+workspace 级, 带最新已发布版本) | POST 新建(蓝图 + 草稿 v1 骨架)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        bps = (Blueprint.objects.filter(workspace__slug=slug, enabled=True)
               .filter(Q(project_id=project_id) | Q(scope="workspace"))
               .order_by("name"))
        return Response([_bp(b, _latest_published(b)) for b in bps], status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        d = request.data or {}
        name = (d.get("name") or "").strip()[:100]
        title = (d.get("title") or name).strip()[:120]
        if not name:
            return Response({"error": "name (slug) required"}, status=status.HTTP_400_BAD_REQUEST)
        if Blueprint.objects.filter(workspace__slug=slug, project_id=project_id, name=name).exists():
            return Response({"error": "name already exists"}, status=status.HTTP_400_BAD_REQUEST)
        uid = request.user.id
        from plane.db.models import Project
        wid = Project.objects.values_list("workspace_id", flat=True).get(pk=project_id)
        b = Blueprint.objects.create(
            name=name, description=title, project_id=project_id, workspace_id=wid,
            permission={"use": ["ADMIN", "MEMBER"], "edit": ["ADMIN"]},
            created_by_id=uid, updated_by_id=uid)
        skeleton = {
            "blueprint": name, "title": title, "version": 1,
            "instantiate": {"card": {"labels": [], "name_template": "{title}"}, "row": None, "resources": []},
            "stages": [], "dag": None, "approvals": [], "sla": [], "notifications": [],
            "guards": {"incomplete": "mark"},
            "permission": {"use": ["ADMIN", "MEMBER"], "edit": ["ADMIN"]},
        }
        BlueprintVersion.objects.create(
            blueprint=b, version=1, definition=skeleton, changelog="草稿",
            project_id=project_id, workspace_id=wid, created_by_id=uid, updated_by_id=uid)
        return Response(_bp(b, None), status=status.HTTP_201_CREATED)


class BlueprintDetailEndpoint(BaseAPIView):
    """GET 详情(meta+版本史+草稿+编辑器 refs) | PATCH 存草稿/改 meta(ADMIN)."""

    def _get(self, slug, project_id, blueprint_id):
        return Blueprint.objects.get(
            Q(project_id=project_id) | Q(scope="workspace"),
            pk=blueprint_id, workspace__slug=slug)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, blueprint_id):
        try:
            b = self._get(slug, project_id, blueprint_id)
        except Blueprint.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        latest = _latest_published(b)
        draft = _draft(b)
        versions = [
            {"version": v.version, "published_at": v.published_at.isoformat() if v.published_at else None, "changelog": v.changelog}
            for v in BlueprintVersion.objects.filter(blueprint=b).order_by("-version")
        ]
        base = draft.definition if draft else (latest.definition if latest else None)
        return Response({
            **_bp(b, latest),
            "versions": versions,
            "draft": base,
            "draft_version": draft.version if draft else None,
            "refs": _editor_refs(slug, b.project_id),
        }, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, blueprint_id):
        try:
            b = self._get(slug, project_id, blueprint_id)
        except Blueprint.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        uid = request.user.id
        if "enabled" in d:
            b.enabled = bool(d["enabled"])
        if d.get("title"):
            b.description = str(d["title"]).strip()[:120]
        b.updated_by_id = uid
        b.save()
        if isinstance(d.get("definition"), dict):
            defn = d["definition"]
            draft = _draft(b)
            if draft:
                draft.definition = defn
                draft.updated_by_id = uid
                draft.save(update_fields=["definition", "updated_by", "updated_at"])
            else:
                last = BlueprintVersion.objects.filter(blueprint=b).order_by("-version").first()
                draft = BlueprintVersion.objects.create(
                    blueprint=b, version=(last.version + 1 if last else 1), definition=defn, changelog="草稿",
                    project_id=b.project_id, workspace_id=b.workspace_id, created_by_id=uid, updated_by_id=uid)
        return Response({"ok": True, "draft_version": _draft(b).version if _draft(b) else None}, status=status.HTTP_200_OK)


class BlueprintPublishEndpoint(BaseAPIView):
    """POST /blueprints/{bid}/publish/ — 静态校验(引用全解析)→ 盖戳发布草稿(ADMIN)."""

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, blueprint_id):
        try:
            b = Blueprint.objects.get(
                Q(project_id=project_id) | Q(scope="workspace"),
                pk=blueprint_id, workspace__slug=slug)
        except Blueprint.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        draft = _draft(b)
        if not draft:
            return Response({"error": "no draft to publish"}, status=status.HTTP_400_BAD_REQUEST)
        _, errors = _resolve(draft.definition or {}, slug, b.project_id)
        if errors:
            return Response({"error": "validation failed", "details": errors}, status=status.HTTP_400_BAD_REQUEST)
        from django.utils import timezone
        draft.published_at = timezone.now()
        draft.changelog = ((request.data or {}).get("changelog") or "").strip()[:500] or draft.changelog
        draft.updated_by_id = request.user.id
        draft.save(update_fields=["published_at", "changelog", "updated_by", "updated_at"])
        return Response({"published": draft.version}, status=status.HTTP_200_OK)


def _stage_label(tmpl):
    """站名 = 模板的 {{title}} 前缀(如 '💰 询价 — {{title}}' → '💰 询价')。"""
    return (tmpl or "").split("{{title}}")[0].strip(" —–-|·:") or None


def _dag_progress(defn, kids):
    """实例运行进度(B-2c): version 钉死的 dag.tasks × 根卡子卡状态。
    卡站按模板片段匹配({{title}}→通配, 其余转义); 审批站无卡, 按前后站推断:
    任一后继已建出→done, 前置全 done 而后继未出→current(审批中)。"""
    import re as _re

    tasks = (defn.get("dag") or {}).get("tasks") or []
    if not tasks:
        return None
    out = []
    for t in tasks:
        key = (t.get("key") or "?").strip()
        if t.get("approval") is not None:
            # B-5c: 審査站も軽カードを持つ(B-5a ApprovalWorkflow が
            # 「審査: {subject} #hash6」を建てる)— 在れば做事站同様の実況
            # (カード状態由来)+ 跳先 issue を付ける。無ければ(旧実例/建卡
            # 失敗)後段の前後站推断にフォールバック。subject 空時の Go 側
            # fallback は「审批 — {{title}}」(buildApprovalInput と同期)。
            subj = ((t.get("approval") or {}).get("subject") or "").strip() or "审批 — {{title}}"
            apat = "審査: " + ".*".join(_re.escape(p) for p in subj.split("{{title}}")) + r" #[0-9a-f]{6}"
            ahits = [(nm, seq, grp, iid) for (nm, seq, grp, iid) in kids if _re.fullmatch(apat, nm)]
            anode = {"key": key, "kind": "approval",
                     "label": _stage_label((t.get("approval") or {}).get("subject")) or key,
                     "status": "pending"}
            if ahits:
                amain = sorted(ahits, key=lambda h: h[1])[0]
                anode["issue"] = {"id": str(amain[3]), "sequence_id": amain[1]}
                agrp = amain[2]
                anode["status"] = ("done" if agrp == "completed"
                                   else "cancelled" if agrp == "cancelled" else "current")
            out.append(anode)
            continue
        tmpl = t.get("card") or ""
        # B-3e 并行度: 副本卡名=主名「・N」→ 模板匹配放宽可选后缀; 站状态聚合全部匹配卡
        # (全 done 才 done / 任一活跃 = current), 否则进度链会漏副本、首张完成即误绿。
        pat = (".*".join(_re.escape(p) for p in tmpl.split("{{title}}")) + r"(・\d+)?") if tmpl else ""
        hits = [(nm, seq, grp, iid) for (nm, seq, grp, iid) in kids
                if pat and _re.fullmatch(pat, nm)] if tmpl else []
        st = "pending"
        node = {"key": key, "kind": "card", "label": _stage_label(tmpl) or key}
        if hits:
            groups = [h[2] for h in hits]
            if all(g == "completed" for g in groups):
                st = "done"
            elif all(g == "cancelled" for g in groups):
                st = "cancelled"
            else:
                st = "current"
            main = sorted(hits, key=lambda h: h[1])[0]  # 主卡 = 创建序最早(seq 最小)
            node["issue"] = {"id": str(main[3]), "sequence_id": main[1]}
            if len(hits) > 1:
                node["cards"] = len(hits)
                node["cards_done"] = sum(1 for g in groups if g == "completed")
        node["status"] = st
        out.append(node)
    bykey = {o["key"]: o for o in out}
    for t in tasks:  # 审批站推断(B-5c: 軽カード実況が在ればそれが権威 → skip)
        if t.get("approval") is None:
            continue
        k = (t.get("key") or "?").strip()
        if bykey.get(k, {}).get("issue"):
            continue
        succ_started = any(bykey.get((x.get("key") or "").strip(), {}).get("status")
                           in ("done", "current", "cancelled")
                           for x in tasks if k in (x.get("after") or []))
        deps_done = all(bykey.get(d, {}).get("status") == "done"
                        for d in (t.get("after") or []))
        if succ_started:
            bykey[k]["status"] = "done"
        elif deps_done:
            bykey[k]["status"] = "current"
    return out


class BlueprintInstancesEndpoint(BaseAPIView):
    """GET /blueprints/{bid}/instances/ — 实例列表(根卡/版本/状态/运行进度)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, blueprint_id):
        qs = list(
            BlueprintInstance.objects
            .filter(version__blueprint_id=blueprint_id, workspace__slug=slug)
            .select_related("version", "root_issue", "root_issue__state")
            .order_by("-created_at")[:200])
        # B-2c: 子卡批量预取(单查), 防 N+1
        children = {}
        for pid_, nm, seq, grp, iid in Issue.objects.filter(
                parent_id__in=[i.root_issue_id for i in qs]
        ).values_list("parent_id", "name", "sequence_id", "state__group", "id"):
            children.setdefault(pid_, []).append((nm, seq, grp, iid))
        out = [{
            "id": str(i.id), "version": i.version.version, "status": i.status,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "issue": {
                "id": str(i.root_issue_id), "name": i.root_issue.name,
                "sequence_id": i.root_issue.sequence_id,
                "state": i.root_issue.state.name if i.root_issue.state_id else None,
            },
            "progress": _dag_progress(i.version.definition or {},
                                      children.get(i.root_issue_id) or []),
        } for i in qs]
        return Response(out, status=status.HTTP_200_OK)


class IssueBlueprintInstanceEndpoint(BaseAPIView):
    """GET /issues/{iid}/blueprint-instance/ — 卡内蓝图徽标 + B-2j 流程上下文条.
    B-2j(2026-06-10): 站卡(子卡)も parent 経由で実例を逆引きし、
    progress(B-2c 同型)+ current_key(本卡=どの站か)+ guide(行動指引素材:
    表単名/wait/次站とその担当)を返す。全て def からの読時投影(SoR 不変)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        i = (BlueprintInstance.objects
             .filter(root_issue_id=issue_id, workspace__slug=slug)
             .select_related("version", "version__blueprint", "root_issue").first())
        if not i:  # 站卡? → parent が root の実例を逆引き
            child = Issue.objects.filter(id=issue_id, workspace__slug=slug).only("parent_id").first()
            if child and child.parent_id:
                i = (BlueprintInstance.objects
                     .filter(root_issue_id=child.parent_id, workspace__slug=slug)
                     .select_related("version", "version__blueprint", "root_issue").first())
        if not i:  # B-2l 需求卡? → 自分の子卡に流程根卡が居れば其実例(最新)を表示
            i = (BlueprintInstance.objects
                 .filter(root_issue__parent_id=issue_id, workspace__slug=slug)
                 .select_related("version", "version__blueprint", "root_issue")
                 .order_by("-created_at").first())
        if not i:
            return Response({"bound": False}, status=status.HTTP_200_OK)
        defn = i.version.definition or {}
        is_root = str(i.root_issue_id) == str(issue_id)
        kids = [(nm, seq, grp, iid_) for nm, seq, grp, iid_ in Issue.objects.filter(
            parent_id=i.root_issue_id).values_list("name", "sequence_id", "state__group", "id")]
        progress = _dag_progress(defn, kids) or []
        current_key = None
        if not is_root:
            current_key = next((p["key"] for p in progress
                                if p.get("issue") and p["issue"]["id"] == str(issue_id)), None)
        # 行動指引素材(本站の def task から派生; 完了済站は guide 不要)
        guide = None
        cur = next((p for p in progress if p["key"] == current_key), None) if current_key else None
        if current_key and cur and cur.get("status") in ("current", "pending"):
            tasks = (defn.get("dag") or {}).get("tasks") or []
            t = next((x for x in tasks if (x.get("key") or "").strip() == current_key), None)
            if t:
                nxt = []
                for x in tasks:
                    if current_key in (x.get("after") or []) and x.get("approval") is None:
                        names = []
                        aids = x.get("assignees") or []
                        if aids:
                            from plane.db.models import User

                            names = [u.display_name or u.email for u in
                                     User.objects.filter(id__in=aids)]
                        nxt.append({"label": _stage_label(x.get("card")) or x.get("key"),
                                    "assignees": names})
                    elif current_key in (x.get("after") or []):
                        nxt.append({"label": _stage_label((x.get("approval") or {}).get("subject"))
                                    or "审批", "approval": True,
                                    "assignees": [a.get("name") for a in
                                                  (x.get("approval") or {}).get("approvers") or []]})
                guide = {
                    "form": (t.get("bind") or {}).get("form"),
                    "wait": bool(t.get("wait")),
                    "next": nxt,
                }
        return Response({
            "bound": True, "blueprint": i.version.blueprint.name,
            "title": defn.get("title") or i.version.blueprint.name,
            "version": i.version.version, "status": i.status, "instance_id": str(i.id),
            # B-2j 流程上下文
            "is_root": is_root,
            "root_issue": {
                "id": str(i.root_issue_id), "name": i.root_issue.name,
                "sequence_id": i.root_issue.sequence_id,
                "project_id": str(i.root_issue.project_id),
            },
            "progress": progress,
            "current_key": current_key,
            "guide": guide,
        }, status=status.HTTP_200_OK)


class IssueFlowInterveneEndpoint(BaseAPIView):
    """B-3e: 管理员流程干预(set_parallelism / skip)。POST issues/{iid}/flow-intervene/
    body {verb, key, n?, reason} — actor 服务端解析; 实例按卡三向反查(root/parent/children);
    业务校验在 Temporal Update validator(审批站不可跳等), 拒绝原因同步返回人话。"""

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, issue_id):
        if not _CARDS_TOKEN:
            return Response({"error": "ai-bot bridge not configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        i = (BlueprintInstance.objects
             .filter(root_issue_id=issue_id, workspace__slug=slug).first())
        if not i:
            child = Issue.objects.filter(id=issue_id, workspace__slug=slug).only("parent_id").first()
            if child and child.parent_id:
                i = BlueprintInstance.objects.filter(root_issue_id=child.parent_id, workspace__slug=slug).first()
        if not i:
            i = (BlueprintInstance.objects
                 .filter(root_issue__parent_id=issue_id, workspace__slug=slug)
                 .order_by("-created_at").first())
        if not i:
            return Response({"error": "no flow instance"}, status=status.HTTP_404_NOT_FOUND)
        d = request.data or {}
        verb = (d.get("verb") or "").strip()
        key = (d.get("key") or "").strip()
        reason = (d.get("reason") or "").strip()[:300]
        if verb not in ("set_parallelism", "skip") or not key or not reason:
            return Response({"error": "verb(set_parallelism|skip) + key + reason required"},
                            status=status.HTTP_400_BAD_REQUEST)
        actor = (getattr(request.user, "display_name", "") or str(request.user.email or "")).strip()
        try:
            r = requests.post(
                f"{_AIBOT_BASE}/blueprint/intervene",
                json={"id": f"bp-{i.id}", "op": {
                    "verb": verb, "key": key, "n": int(d.get("n") or 0),
                    "reason": reason, "actor": actor,
                }},
                headers={"X-Cards-Token": _CARDS_TOKEN}, timeout=35)
            j = r.json()
        except Exception as e:
            logger.exception("flow intervene proxy failed")
            return Response({"error": f"ai-bot unreachable: {type(e).__name__}"},
                            status=status.HTTP_502_BAD_GATEWAY)
        if not isinstance(j, dict) or not j.get("ok"):
            return Response({"error": (j or {}).get("msg") or "intervention rejected"},
                            status=status.HTTP_400_BAD_REQUEST)
        # B-3e 审计 = 原生 activity 行(2026-06-11 用户拍板: 评论留痕→通知疲劳, 弃用)。
        # 干预入口在本端点 → 留痕就地 ORM 写入(零通知零评论, 折在活动流)。
        try:
            import time as _t

            from plane.db.models import IssueActivity

            defn = (i.version.definition or {}) if i.version_id else {}
            tasks = (defn.get("dag") or {}).get("tasks") or []
            t_ = next((x for x in tasks if (x.get("key") or "").strip() == key), None)
            label = _stage_label((t_ or {}).get("card")) or _stage_label(((t_ or {}).get("approval") or {}).get("subject")) or key
            text = (f"将流程站「{label}」并行度设为 ×{int(d.get('n') or 0)}" if verb == "set_parallelism"
                    else f"跳过了流程站「{label}」") + f"(理由: {reason})"
            IssueActivity.objects.create(
                issue_id=i.root_issue_id, project_id=i.root_issue.project_id,
                workspace_id=i.workspace_id, actor=request.user,
                verb="updated", field="flow_intervene", comment=text,
                epoch=_t.time())
        except Exception:
            logger.exception("flow intervene activity write failed (non-fatal)")
        return Response(j, status=status.HTTP_200_OK)


class BlueprintInstantiateEndpoint(BaseAPIView):
    """POST /workspaces/{slug}/projects/{pid}/blueprints/{bid}/instantiate/  body {title, customer?, seed_cells?}"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, blueprint_id):
        try:
            b = Blueprint.objects.get(
                Q(project_id=project_id) | Q(scope="workspace"),
                pk=blueprint_id, workspace__slug=slug, enabled=True)
        except Blueprint.DoesNotExist:
            return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
        version = _latest_published(b)
        if not version:
            return Response({"error": "no published version"}, status=status.HTTP_400_BAD_REQUEST)
        d = request.data or {}
        title = (d.get("title") or "").strip()
        if not title:
            return Response({"error": "title required"}, status=status.HTTP_400_BAD_REQUEST)
        # B-2l: 从需求卡发起 — 校验 parent 卡确属本项目(防跨项目挂树)
        parent_issue = (d.get("parent_issue") or "").strip() or None
        if parent_issue and not Issue.objects.filter(
                id=parent_issue, project_id=project_id, workspace__slug=slug).exists():
            return Response({"error": "parent_issue not in this project"}, status=status.HTTP_400_BAD_REQUEST)
        result, errors = instantiate_blueprint(
            version, slug=slug, project_id=project_id, workspace_id=b.workspace_id,
            user=request.user, title=title[:200], customer=(d.get("customer") or "").strip()[:80],
            seed_cells=d.get("seed_cells") if isinstance(d.get("seed_cells"), dict) else None,
            parent_issue=parent_issue)
        if errors:
            return Response({"error": "unresolved references", "details": errors}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_201_CREATED)
