# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# BARSOUL: 派生卡片当前态 (Derived Issue State, DIS) 读取端点。
# 看板卡顶状态行用。一次批量拉可见卡的 ai_state,避免 N+1,且不污染 Plane
# 热路径 issue-list serializer。详 docs/architecture/derived-issue-state-mvp.md。

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueAIState


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
    }


class IssueAIStateBatchEndpoint(BaseAPIView):
    """GET /api/workspaces/{slug}/projects/{pid}/issues/ai-states/?issues=<id,id,...>
    项目成员读。返 {issue_id: DerivedIssueState}。最多 300 卡/次。
    无 issues 参数 → 返该 project 全部已派生卡 (上限 500)。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        raw = (request.query_params.get("issues") or "").strip()
        # 仅活跃卡(Todo/Doing)返派生态 → Done/Cancelled 卡(残留旧行)不显示 AI 行
        qs = IssueAIState.objects.filter(
            workspace__slug=slug, project_id=project_id,
            issue__state__group__in=["unstarted", "started"],
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
