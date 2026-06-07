# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# BARSOUL: 派生卡片当前态 (Derived Issue State, DIS) 读取端点。
# 看板卡顶状态行用。一次批量拉可见卡的 ai_state,避免 N+1,且不污染 Plane
# 热路径 issue-list serializer。详 docs/architecture/derived-issue-state-mvp.md。

# Python imports
import os
import json
import logging
import requests

# Django imports
from django.utils import timezone
from django.db.models import Q
from django.core.serializers.json import DjangoJSONEncoder

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueAIState, IssueAIStateCorrection, Issue, IssueComment
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host

logger = logging.getLogger(__name__)
# 复用既有 ai-bot 入口(host.docker.internal:8098);去掉 /translate 取根
_AIBOT = os.environ.get("AIBOT_TRANSLATE_URL", "http://host.docker.internal:8098/translate").rsplit("/translate", 1)[0]


def _has_kana(t):
    return any("぀" <= c <= "ヿ" for c in (t or ""))


def _aibot_translate(text, target):
    try:
        # timeout=45: 与评论区按需翻译一致(comment.py)。ai-bot 内 cloud Claude 上限 ~30s,
        # HTTP 必须给足余量,否则 plane-api 先于 ai-bot 超时 → 误判 translation failed。
        r = requests.post(f"{_AIBOT}/translate", json={"text": text, "target": target}, timeout=45)
        if r.ok:
            return (r.json() or {}).get("text") or ""
    except Exception:
        logger.warning("ai-state correct: translate failed (非致命)", exc_info=True)
    return ""


def _trigger_rederive(project_id, issue_id):
    try:  # fire-and-forget; worker 异步用 human_note 重判
        requests.post(f"{_AIBOT}/derive-issue-state",
                      json={"project_id": str(project_id), "issue_id": str(issue_id), "force": True}, timeout=2)
    except Exception:
        pass


def _post_audit_comment(request, issue, project_id, note, by):
    """把人手的「向 AI 补充/纠正」原样发成 issue 评论 → **在任务时间线可见、可追溯**。
    这是「留痕」真正给人看的落点(派生表 + 审计表是给程序/AI 的,人看不到)。
    以补充者本人身份发(本人会话);对方语言由评论区自动翻译。失败非致命。"""
    try:
        safe = (note or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
        html = (f"<p>📝 <b>AIへの補足・履歴 / AI 补充说明(留痕)</b>"
                f"{(' — ' + by) if by else ''}</p><p>{safe}</p>")
        uid = request.user.id if request.user.is_authenticated else None
        IssueComment.objects.create(
            workspace_id=issue.workspace_id, project_id=project_id, issue=issue,
            actor=(request.user if request.user.is_authenticated else None),
            comment_html=html, comment_stripped=(note or ""), access="INTERNAL",
            created_by_id=uid, updated_by_id=uid)
        issue_activity.delay(
            type="comment.activity.created",
            requested_data=json.dumps({"comment_html": html, "comment_stripped": note}, cls=DjangoJSONEncoder),
            actor_id=str(uid) if uid else None,
            issue_id=str(issue.id), project_id=str(project_id),
            current_instance=None, epoch=int(timezone.now().timestamp()),
            notification=True, origin=base_host(request=request, is_app=True))
    except Exception:
        logger.warning("ai-state correct: 留痕评论发布失败 (非致命)", exc_info=True)


def _serialize(row):
    issue = row.issue
    st = getattr(issue, "state", None)
    return {
        "issue_id": str(row.issue_id),
        # issue meta(待我处理 digest 用; 卡面行忽略)
        "name": issue.name if issue else "",
        "sequence_id": issue.sequence_id if issue else None,
        "project_identifier": row.project.identifier if row.project_id else "",
        "state_group": st.group if st else None,
        "state": row.state,
        "ball": row.ball or None,                       # SELF | OTHER | None
        # 当前行动人
        "actor_kind": row.actor_kind or None,           # person | external | None
        "actor_name": row.current_actor or None,
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
        "owner": row.owner or None,
        "unassigned": bool(row.unassigned),
        # 等待对象(ball=OTHER), 双语(ja 缺则回退 zh, 保证日文阅览者不见空/中文)
        "waiting_on": {"zh": row.waiting_on_zh or "", "ja": row.waiting_on_ja or row.waiting_on_zh or ""},
        # 下一步, 双语(zh 兜底 ja)
        "next_action": {"zh": row.next_action or "", "ja": row.next_action_ja or row.next_action or ""},
        # 推断依据
        "reasoning": {"zh": row.reasoning or "", "ja": row.reasoning_ja or row.reasoning or ""},
        "source": {"author": row.source_author or "", "quote": row.source_quote or ""},
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "stale_days": row.stale_days,
        "confidence": row.confidence,
        "model_used": row.model_used or None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        # 人手补充/纠正(留痕): 双语补充说明 + 纠正者/时间
        "human_note": {"zh": row.human_note_zh or "", "ja": row.human_note_ja or row.human_note_zh or ""},
        "corrected_by": row.corrected_by or None,
        "corrected_at": row.corrected_at.isoformat() if row.corrected_at else None,
        # 信息完整性/留痕缺口: 状态与材料矛盾/不足 → 要求人补充
        "needs_info": bool(row.needs_info),
        "info_gap": {"zh": row.info_gap_zh or "", "ja": row.info_gap_ja or row.info_gap_zh or ""},
        # 补充框架(AI 理解 + 待澄清点;告诉补充人该写什么,按阅览者语言展示)
        "info_framework": {"zh": row.info_framework_zh or "", "ja": row.info_framework_ja or row.info_framework_zh or ""},
    }


class IssueAIStateBatchEndpoint(BaseAPIView):
    """GET /api/workspaces/{slug}/projects/{pid}/issues/ai-states/?issues=<id,id,...>
    项目成员读。返 {issue_id: DerivedIssueState}。最多 300 卡/次。
    无 issues 参数 → 返该 project 全部已派生卡 (上限 500)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        raw = (request.query_params.get("issues") or "").strip()
        # 活跃卡(Todo/Doing)正常返派生态;**外加** needs_info=True 的卡(含已完成/取消):
        #   状态变更缺留痕,需要人补说明 → 必须能被看到/被追,直到补全。
        # 其余 Done/Cancelled(留痕完整)不返 → 不显示陈旧 AI 行。
        qs = IssueAIState.objects.filter(
            Q(issue__state__group__in=["unstarted", "started"]) | Q(needs_info=True),
            workspace__slug=slug, project_id=project_id,
        ).select_related("issue", "issue__state", "project")
        if raw:
            ids = [x for x in (s.strip() for s in raw.split(",")) if x][:300]
            qs = qs.filter(issue_id__in=ids)
        else:
            qs = qs.order_by("-updated_at")[:500]

        out = {}
        for row in qs:
            out[str(row.issue_id)] = _serialize(row)
        return Response(out, status=status.HTTP_200_OK)


class IssueAIStateCorrectEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/correct/
    Body: {note}. 人进详情向 AI 补足背景说明 → 自动双语存储 + 审计留痕 + 触发 AI 重判。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        note = ((request.data or {}).get("note") or "").strip()[:1000]
        if not note:
            return Response({"error": "note required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        except Issue.DoesNotExist:
            return Response({"error": "issue not found"}, status=status.HTTP_404_NOT_FOUND)

        # 多语言自动化: 录入原文 + 另一语言机翻
        lang = "ja" if _has_kana(note) else "zh"
        note_ja = note if lang == "ja" else (_aibot_translate(note, "ja") or note)
        note_zh = note if lang == "zh" else (_aibot_translate(note, "zh") or note)
        by = (getattr(request.user, "display_name", "") or getattr(request.user, "email", "") or "")[:120]

        row = IssueAIState.all_objects.filter(issue=issue).first()
        prev_ball = (row.ball if row else "") or ""
        prev_actor = (row.current_actor if row else "") or ""
        uid = request.user.id if request.user.is_authenticated else None
        if row:
            row.deleted_at = None
            row.human_note_zh = note_zh
            row.human_note_ja = note_ja
            row.corrected_by = by
            row.corrected_at = timezone.now()
            row.updated_by_id = uid
            row.save()
        else:
            row = IssueAIState.objects.create(
                issue=issue, project_id=project_id, workspace_id=issue.workspace_id,
                human_note_zh=note_zh, human_note_ja=note_ja, corrected_by=by,
                corrected_at=timezone.now(), created_by_id=uid, updated_by_id=uid)

        # 留痕①(程序/AI 可追溯): append-only 审计行(含当时旧 ball/actor)
        IssueAIStateCorrection.objects.create(
            issue=issue, project_id=project_id, workspace_id=issue.workspace_id,
            note_zh=note_zh, note_ja=note_ja, note_lang=lang,
            prev_ball=prev_ball, prev_actor=prev_actor,
            created_by_id=uid, updated_by_id=uid)

        # 留痕②(人看得到): 发成 issue 评论 → 出现在任务时间线,可被任何人审阅追溯
        _post_audit_comment(request, issue, project_id, note, by)

        # 触发 AI 用补充信息重判(worker 读 human_note → prompt 最优先考虑)
        _trigger_rederive(project_id, issue_id)

        fresh = IssueAIState.objects.select_related("issue", "issue__state", "project").get(pk=row.pk)
        return Response(_serialize(fresh), status=status.HTTP_200_OK)


class IssueAIStateTranslateEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/translate/
    Body: {text, target?}. 翻译引用依据片段(走 ai-bot,与评论区同款翻译引擎)。
    target 省略时自动翻到另一语言(zh↔ja)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        text = ((request.data or {}).get("text") or "").strip()[:1000]
        if not text:
            return Response({"text": ""}, status=status.HTTP_200_OK)
        target = ((request.data or {}).get("target") or "").strip().lower()[:2]
        if target not in ("zh", "ja"):
            target = "zh" if _has_kana(text) else "ja"
        out = _aibot_translate(text, target)
        return Response({"text": out or "", "target": target}, status=status.HTTP_200_OK)


class IssueAIStateRederiveEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/ai-state/rederive/
    手动触发 AI 重新分析该卡。**仅重算派生表(issue_ai_states),绝不写 SoR**。
    fire-and-forget(worker 异步重判);幂等。用户怀疑 AI 判断过时/有误时主动刷新。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        try:
            Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        except Issue.DoesNotExist:
            return Response({"error": "issue not found"}, status=status.HTTP_404_NOT_FOUND)
        _trigger_rederive(project_id, issue_id)
        return Response({"ok": True}, status=status.HTTP_202_ACCEPTED)
