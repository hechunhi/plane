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
    return {
        "issue_id": str(row.issue_id),
        "state": row.state,
        "ball": row.ball or None,
        "current_actor": row.current_actor or None,
        "owner": row.owner or None,
        "next_action": row.next_action or "",
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "stale_days": row.stale_days,
        "confidence": row.confidence,
        "reasoning": row.reasoning or None,
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
        qs = IssueAIState.objects.filter(
            workspace__slug=slug, project_id=project_id
        )
        if raw:
            ids = [x for x in (s.strip() for s in raw.split(",")) if x][:300]
            qs = qs.filter(issue_id__in=ids)
        else:
            qs = qs.order_by("-updated_at")[:500]

        out = {}
        for row in qs:
            out[str(row.issue_id)] = _serialize(row)
        return Response(out, status=status.HTTP_200_OK)
