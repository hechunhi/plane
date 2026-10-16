# BARSOUL 2026-10-08 (hechun「搜索功能好好做, 接入 AI 搜索, 全屏浮层」):
# 全屏搜索浮层的后端。设计 = memory project_plane_ai_search (D1-D10 已批, 别重开)。
#
#   GET /api/workspaces/{slug}/barsoul-search/?q=…&limit=20
#
# - D3 编号直达: "BS-425" / "bs425" / "ORD 12" → 精确命中排第一, 不走语义。
# - D4 混合检索: Postgres 关键字(标题+描述+评论, 多词 AND icontains)
#        + plane-leann :8077 语义, RRF(k=60) 合并, 每条标 match=keyword|semantic。
#   数据量小(几百张卡)→ 先不建 pg_trgm 索引, 量大了再加(纯性能, 不改结果)。
# - D5 权限在这里过滤: leann 索引不分权限, 语义结果一律回查「我能看的卡」集合,
#   不在集合里的直接丢; guest(未开 guest_view_all_features)只看自己建的卡。
# - Q3 默认含已归档/已完成, 带 archived / state_group 给前端灰显。
# - 只读: 不写任何表。leann 挂了 fail-open(只剩关键字结果, degraded=true)。

import os
import re
import logging

import requests as _req
from django.db.models import Exists, OuterRef, Q
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Issue, IssueAssignee, IssueComment, ProjectMember

logger = logging.getLogger(__name__)

_LEANN_URL = os.environ.get("PLANE_LEANN_URL", "http://host.docker.internal:8077").rstrip("/")
# 非贪婪: "bs425" 要切成 BS + 425, 不能被 [A-Za-z0-9] 吃掉数字
_ID_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9]*?)[\s\-_]?(\d{1,6})\s*$")
_RRF_K = 60
_SNIP = 70  # 片段两侧各取多少字
# leann 分数是相对的(乱码也有 0.49): 绝对下限 + 相对首位的落差, 再封顶条数
_SEM_FLOOR = 0.5
_SEM_DROP = 0.25
_SEM_MAX = 8
# 问爱酱(P1): 资料张数 / 每张描述上限 / 每张评论条数与上限
_AIBOT_BASE = os.environ.get("AIBOT_URL", "http://host.docker.internal:8098").rstrip("/")
_CARDS_INTERNAL_TOKEN = os.environ.get("CARDS_INTERNAL_TOKEN", "").strip()
_ASK_SOURCES = 8
_ASK_DESC = 700
_ASK_CMT_N = 3
_ASK_CMT = 350
_ASK_LANGS = {"ja", "zh-CN", "zh-TW", "en"}
_STATE_GROUPS = {"backlog", "unstarted", "started", "completed", "cancelled"}
_UUID_RE = re.compile(r"^[0-9a-fA-F-]{32,36}$")
_CITE_RE = re.compile(r"\[\d{1,2}(?:\s*[,，、]\s*\d{1,2})*\]")


def _filters(src, user):
    """P2 @筛选: assignee(可多选, "me"=自己) / state_group(可多选)。src = GET QueryDict 或 POST dict。"""
    def many(key):
        if hasattr(src, "getlist"):
            v = src.getlist(key)
        else:
            v = src.get(key) or []
        v = v if isinstance(v, list) else [v]
        return [str(x).strip() for x in v if str(x).strip()][:10]

    assignees = []
    for a in many("assignee"):
        if a == "me":
            assignees.append(str(user.id))
        elif _UUID_RE.match(a):
            assignees.append(a)
    groups = [g for g in many("state_group") if g in _STATE_GROUPS]
    return {"assignee": assignees, "state_group": groups}


def _snippet(text, terms):
    """命中词附近截一段(两侧 _SNIP 字), 无命中给开头。纯展示用。"""
    if not text:
        return ""
    flat = " ".join(text.split())
    low = flat.lower()
    pos = -1
    for t in terms:
        p = low.find(t)
        if p >= 0 and (pos < 0 or p < pos):
            pos = p
    if pos < 0:
        return flat[: _SNIP * 2] + ("…" if len(flat) > _SNIP * 2 else "")
    start = max(0, pos - _SNIP)
    end = min(len(flat), pos + _SNIP)
    return ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")


def _terms(q):
    """关键字词: 空白切分, 去掉句尾问号/句号(问句「…谁做?」也能命中)。"""
    out = []
    for t in q.lower().split():
        t = t.strip("?？!！。.,，、")
        if t:
            out.append(t)
    return out[:6]


def _visible_issues(request, slug):
    """提问人能看的卡(D5)。None = 一个项目都不是成员。"""
    members = ProjectMember.objects.filter(
        workspace__slug=slug, member=request.user, is_active=True,
        project__archived_at__isnull=True,
    ).values("project_id", "role", "project__guest_view_all_features")
    open_pids, guest_pids = [], []
    for m in members:
        if m["role"] == ROLE.GUEST.value and not m["project__guest_view_all_features"]:
            guest_pids.append(m["project_id"])
        else:
            open_pids.append(m["project_id"])
    if not open_pids and not guest_pids:
        return None
    return (
        Issue.objects.filter(workspace__slug=slug, is_draft=False)
        .filter(Q(project_id__in=open_pids) | Q(project_id__in=guest_pids, created_by=request.user))
        .exclude(state__group="triage")
    )


def _hybrid_search(request, slug, q, limit, sem_timeout=3, filters=None):
    """关键字 + 语义混合检索(搜索列表与「问爱酱」共用同一套召回/权限)。"""
    visible = _visible_issues(request, slug)
    if visible is None:
        return {"q": q, "exact": None, "results": [], "degraded": False}
    # @筛选 先收窄可见集合 → 关键字/语义/编号三路都只在筛过的卡里
    filters = filters or {}
    if filters.get("assignee"):
        visible = visible.filter(Exists(IssueAssignee.objects.filter(
            issue_id=OuterRef("pk"), assignee_id__in=filters["assignee"], deleted_at__isnull=True)))
    if filters.get("state_group"):
        visible = visible.filter(state__group__in=filters["state_group"])
    has_filter = bool(filters.get("assignee") or filters.get("state_group"))

    # ── D3 编号直达 ──
    exact = None
    m = _ID_RE.match(q)
    if m:
        ident, seq = m.group(1).upper(), int(m.group(2))
        hit = visible.filter(project__identifier__iexact=ident, sequence_id=seq).values_list("id", flat=True).first()
        if hit:
            exact = str(hit)

    # ── 关键字: 多词 AND, 每词在 标题|描述|评论 任一处 ──
    terms = _terms(q)
    kw_ids = []
    if not terms and has_filter:
        # 只有筛选没有词: 按最近更新列出(不跑语义)
        kw_ids = [str(i) for i in visible.order_by("-updated_at").values_list("id", flat=True)[:limit]]
    if terms:
        kw = visible
        for t in terms:
            has_comment = IssueComment.objects.filter(
                issue_id=OuterRef("pk"), deleted_at__isnull=True, comment_stripped__icontains=t
            )
            kw = kw.filter(Q(name__icontains=t) | Q(description_stripped__icontains=t) | Exists(has_comment))
        rows = list(kw.values("id", "name").order_by("-updated_at")[:80])
        # 标题命中多的排前(同分保持「最近更新」顺序)
        rows.sort(key=lambda r: -sum(1 for t in terms if t in (r["name"] or "").lower()))
        kw_ids = [str(r["id"]) for r in rows]

    # ── 语义: plane-leann (fail-open) ──
    degraded = False
    sem_hits = []  # [(identifier, snippet, kind)]
    # 编号直达时不跑语义(D3): "BS-425" 的语义近邻只是噪音
    try:
        data = []
        if not exact and terms:
            r = _req.post(_LEANN_URL + "/search", json={"query": q, "top_k": 20}, timeout=sem_timeout)
            data = r.json() if r.status_code == 200 else []
        if isinstance(data, dict):
            data = data.get("results") or []
        data = [h for h in data if isinstance(h, dict)] if isinstance(data, list) else []
        top = max((float(h.get("score") or 0) for h in data), default=0.0)
        for h in data:
            sc = float(h.get("score") or 0)
            if sc < _SEM_FLOOR or sc < top - _SEM_DROP:
                continue
            ident = str(h.get("identifier") or "").strip().upper()
            if ident:
                sem_hits.append((ident, str(h.get("snippet") or ""), str(h.get("kind") or "issue")))
    except Exception as e:  # noqa: BLE001 — 语义挂了只降级, 绝不让搜索整体失败
        logger.warning("barsoul-search: leann unreachable: %s", type(e).__name__)
        degraded = True

    # identifier → 可见 issue id(D5: 不在可见集合的语义命中直接丢)
    sem_ids, sem_snip = [], {}
    if sem_hits:
        want = {}
        for ident, snip, kind in sem_hits:
            mm = re.match(r"^([A-Z0-9]+)-(\d+)$", ident)
            if mm and ident not in want:
                want[ident] = (mm.group(1), int(mm.group(2)), snip, kind)
        cond = Q()
        for p_ident, seq, _s, _k in want.values():
            cond |= Q(project__identifier=p_ident, sequence_id=seq)
        found = {
            f"{r['project__identifier']}-{r['sequence_id']}": str(r["id"])
            for r in visible.filter(cond).values("id", "project__identifier", "sequence_id")
        }
        for ident, (_p, _s, snip, kind) in want.items():
            iid = found.get(ident)
            if iid and iid not in sem_snip and len(sem_ids) < _SEM_MAX:
                sem_ids.append(iid)
                sem_snip[iid] = (snip, kind)

    # ── RRF 合并 ──
    score = {}
    for rank, iid in enumerate(kw_ids):
        score[iid] = score.get(iid, 0.0) + 1.0 / (_RRF_K + rank + 1)
    for rank, iid in enumerate(sem_ids):
        score[iid] = score.get(iid, 0.0) + 1.0 / (_RRF_K + rank + 1)
    ordered = sorted(score, key=lambda i: -score[i])
    if exact:
        ordered = [exact] + [i for i in ordered if i != exact]
    ordered = ordered[:limit]
    if not ordered:
        return {"q": q, "exact": None, "results": [], "degraded": degraded}

    info = {
        str(r["id"]): r
        for r in Issue.objects.filter(id__in=ordered).values(
            "id", "name", "sequence_id", "project_id", "project__identifier", "project__name",
            "description_stripped", "archived_at", "state__name", "state__group", "state__color",
            "updated_at",
        )
    }

    # 关键字命中只在评论里的 → 给出评论片段 + comment_id(D6 跳 #comment-…)
    kw_set = set(kw_ids)
    comment_snip = {}
    need = [
        i for i in ordered if i in kw_set and i in info
        and not any(t in (info[i]["name"] or "").lower() or t in (info[i]["description_stripped"] or "").lower()
                    for t in terms[:1])
    ]
    if need and terms:
        for c in (
            IssueComment.objects.filter(issue_id__in=need, deleted_at__isnull=True,
                                        comment_stripped__icontains=terms[0])
            .order_by("-created_at").values("id", "issue_id", "comment_stripped")
        ):
            comment_snip.setdefault(str(c["issue_id"]), (str(c["id"]), _snippet(c["comment_stripped"], terms)))

    results = []
    for iid in ordered:
        r = info.get(iid)
        if not r:
            continue
        match = []
        if iid == exact:
            match.append("id")
        if iid in kw_set:
            match.append("keyword")
        if iid in sem_snip:
            match.append("semantic")
        comment_id, snip, where = None, "", "description"
        if iid in comment_snip:
            comment_id, snip = comment_snip[iid]
            where = "comment"
        elif iid in kw_set and terms:
            snip = _snippet(r["description_stripped"] or "", terms)
        elif iid in sem_snip:
            snip, kind = sem_snip[iid]
            snip = " ".join(snip.split())
            # leann 片段以 "[BS-425] 标题 (日期)" 开头, 标题已单独显示 → 去掉前缀
            snip = re.sub(r"^\[[A-Z0-9]+-\d+\]\s*" + re.escape(r["name"] or "") + r"\s*(\(\d{4}-\d{2}-\d{2}\))?\s*", "", snip)
            snip = snip[: _SNIP * 2]
            where = "comment" if kind == "comment" else "description"
        results.append({
            "id": iid,
            "name": r["name"],
            "sequence_id": r["sequence_id"],
            "project_id": str(r["project_id"]),
            "project_identifier": r["project__identifier"],
            "project_name": r["project__name"],
            "state_name": r["state__name"],
            "state_group": r["state__group"],
            "state_color": r["state__color"],
            "archived": r["archived_at"] is not None,
            "updated_at": r["updated_at"],
            "match": match,
            "snippet": snip,
            "snippet_from": where,
            "comment_id": comment_id,
        })
    return {"q": q, "exact": exact, "results": results, "degraded": degraded}


class BarsoulSearchEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        q = (request.query_params.get("q") or "").strip()[:200]
        try:
            limit = max(1, min(40, int(request.query_params.get("limit") or 20)))
        except ValueError:
            limit = 20
        filters = _filters(request.query_params, request.user)
        if not q and not (filters["assignee"] or filters["state_group"]):
            return Response({"q": q, "exact": None, "results": [], "degraded": False})
        return Response(_hybrid_search(request, slug, q, limit, filters=filters))


def _ask_sources(results, terms):
    """检索结果 → 编号资料(给 LLM 的正文 + 给前端的出处卡)。只含提问人可见的卡(D5)。"""
    ids = [r["id"] for r in results]
    desc = {
        str(r["id"]): r["description_stripped"] or ""
        for r in Issue.objects.filter(id__in=ids).values("id", "description_stripped")
    }
    cmts = {}
    for c in (
        IssueComment.objects.filter(issue_id__in=ids, deleted_at__isnull=True)
        .order_by("-created_at")
        .values("id", "issue_id", "comment_stripped", "created_at", "actor__display_name")
    ):
        cmts.setdefault(str(c["issue_id"]), []).append(c)
    llm, cards = [], []
    for n, r in enumerate(results, start=1):
        ident = f"{r['project_identifier']}-{r['sequence_id']}"
        status = r["state_name"] or "-"
        if r["archived"]:
            status += ", archived"
        lines = [f"{ident} 「{r['name']}」 (status: {status}; updated {str(r['updated_at'])[:10]})"]
        d = " ".join(desc.get(r["id"], "").split())
        if d:
            lines.append("Description: " + d[:_ASK_DESC] + ("…" if len(d) > _ASK_DESC else ""))
        # 评论: 命中检索词的优先, 再补最新的, 共 _ASK_CMT_N 条
        cs = cmts.get(r["id"], [])
        hit = [c for c in cs if any(t in (c["comment_stripped"] or "").lower() for t in terms)]
        pick = (hit + [c for c in cs if c not in hit])[:_ASK_CMT_N]
        for c in pick:
            body = " ".join((c["comment_stripped"] or "").split())
            if body:
                lines.append(
                    f"Comment by {c['actor__display_name'] or '?'} ({str(c['created_at'])[:10]}): "
                    + body[:_ASK_CMT] + ("…" if len(body) > _ASK_CMT else "")
                )
        llm.append({"n": n, "text": "\n".join(lines)})
        # 出处卡: 有命中评论就跳那条评论(D6)
        cid = r["comment_id"] or (str(hit[0]["id"]) if hit else None)
        cards.append({**r, "n": n, "ident": ident, "comment_id": cid})
    return llm, cards


class BarsoulSearchAskEndpoint(BaseAPIView):
    """问爱酱(D2/D5/D6/D7): 只读问答。
    POST {action:"ask", q, lang, history[]} → {job_id, sources[]} | {status:"no_sources"}
    POST {action:"poll", job_id}            → ai-bot /ai/chat-job/poll 原样转发(actor 绑定本人)
    POST {action:"feedback", vote, q, reply, sources[]} → ai-bot 追加 jsonl 日志(D10)
    P2: ask 可带 prev_q(追问检索)/ assignee / state_group(@筛选)。
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        if not _CARDS_INTERNAL_TOKEN:
            return Response({"status": "error", "msg": "ai unavailable"}, status=503)
        headers = {"X-Cards-Token": _CARDS_INTERNAL_TOKEN}
        actor = str(request.user.id)
        action = request.data.get("action") or "ask"
        try:
            if action == "poll":
                job_id = str(request.data.get("job_id") or "")[:64]
                r = _req.post(_AIBOT_BASE + "/ai/chat-job/poll",
                              json={"job_id": job_id, "actor_id": actor}, headers=headers, timeout=15)
                return Response(r.json(), status=200 if r.ok else 502)

            if action == "feedback":
                d = request.data
                r = _req.post(_AIBOT_BASE + "/ai/search-feedback", json={
                    "actor_id": actor, "vote": d.get("vote"), "q": d.get("q"), "reply": d.get("reply"),
                    "sources": d.get("sources") or [], "lang": d.get("lang"), "turn": d.get("turn") or 0,
                }, headers=headers, timeout=10)
                return Response({"ok": r.ok}, status=200 if r.ok else 502)

            q = str(request.data.get("q") or "").strip()[:500]
            if not q:
                return Response({"status": "error", "msg": "q required"}, status=400)
            lang = str(request.data.get("lang") or "ja")
            if lang not in _ASK_LANGS:
                lang = "ja"
            history = request.data.get("history") or []
            if not isinstance(history, list):
                history = []
            # 旧回答里的 [n] 指的是上一轮的资料编号, 带进去会串号 → 去掉
            history = [
                {"role": h.get("role"), "content": _CITE_RE.sub("", str(h.get("content") or ""))[:2000]}
                for h in history[-6:]
                if isinstance(h, dict) and h.get("role") in ("user", "assistant")
            ]
            filters = _filters(request.data, request.user)
            # 问答等得起: 语义超时放宽(列表搜索保持 3s)
            found = _hybrid_search(request, slug, q, _ASK_SOURCES, sem_timeout=8, filters=filters)
            # D8 追问: 「那韩国呢」这种短句单独检索会落空 → 再拿「上一问 + 这一问」检索, 交错合并
            prev_q = str(request.data.get("prev_q") or "").strip()[:300]
            if prev_q:
                more = _hybrid_search(request, slug, f"{prev_q} {q}", _ASK_SOURCES, sem_timeout=8, filters=filters)
                merged, seen = [], set()
                for pair in zip(found["results"] + [None] * _ASK_SOURCES, more["results"] + [None] * _ASK_SOURCES):
                    for r in pair:
                        if r and r["id"] not in seen:
                            seen.add(r["id"])
                            merged.append(r)
                found = {**found, "results": merged[:_ASK_SOURCES], "degraded": found["degraded"] or more["degraded"]}
            if not found["results"]:
                return Response({"status": "no_sources", "degraded": found["degraded"]})
            llm, cards = _ask_sources(found["results"], _terms(q))
            r = _req.post(
                _AIBOT_BASE + "/ai/search-answer-job",
                json={"actor_id": actor, "q": q, "lang": lang, "history": history, "sources": llm},
                headers=headers, timeout=15,
            )
            if not r.ok:
                return Response({"status": "error", "msg": f"ai-bot {r.status_code}"}, status=502)
            return Response({"status": "running", "job_id": r.json().get("job_id"),
                             "sources": cards, "degraded": found["degraded"]})
        except _req.RequestException as e:
            logger.warning("barsoul-search ask: ai-bot unreachable: %s", type(e).__name__)
            return Response({"status": "error", "msg": "ai unreachable"}, status=502)
