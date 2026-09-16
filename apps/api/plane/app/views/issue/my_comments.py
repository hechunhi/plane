"""
BARSOUL 2026-09-16 (hechun) — 「我的工作」/my-work の **自分のコメント timeline**。

動機(用户原話): 「我评论了以后,还是挺需要一个我评论的 timeline,方便我追踪我回复的任务」。
通知は「他人が私に何をしたか」の流れで、「私が何を言ったか」は流れない。
自分が最後に口を出したカードを時系列で辿り、**その後に誰か返したか**まで一目で分かる。

GET /api/workspaces/{slug}/my-comments/?offset=0&limit=60
Resp {items:[{
      id, issue_id, project_id, project_identifier, sequence_id, issue_name,
      comment_html, created_at,
      reply: {id, actor_display, actor_avatar, comment_html, created_at} | null,
      is_last: bool           # 自分のコメントがそのカードの最後の(人間の)発言か
    }], has_more: bool}

  - reply = 自分のコメントより後に **他人(bot 除外)** が付けた最新コメント。
    bot(愛ちゃんの自動翻訳等)を返信と数えると「返ってきた」が嘘になる。
  - 認可 = ワークスペース成員 かつ active な project のみ。読み取り専用、SoR 不触。
"""
# Django imports
from django.db.models import Q

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueComment, ProjectMember

_MAX_LIMIT = 100


class WorkspaceMyCommentsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        try:
            offset = max(0, int(request.GET.get("offset", 0)))
            limit = min(_MAX_LIMIT, max(1, int(request.GET.get("limit", 60))))
        except (TypeError, ValueError):
            return Response({"error": "offset/limit must be int"}, status=status.HTTP_400_BAD_REQUEST)

        member_project_ids = list(
            ProjectMember.objects.filter(
                workspace__slug=slug, member=request.user, is_active=True
            ).values_list("project_id", flat=True)
        )
        base = (
            IssueComment.objects.filter(
                workspace__slug=slug,
                actor=request.user,
                project_id__in=member_project_ids,
                issue__deleted_at__isnull=True,
            )
            .select_related("issue", "project")
            .order_by("-created_at")
        )
        mine = list(base[offset : offset + limit + 1])
        has_more = len(mine) > limit
        mine = mine[:limit]
        if not mine:
            return Response({"items": [], "has_more": False})

        # 返信検出: このページに出る issue の、自分の最古コメント以降の他人コメントを 1 クエリで。
        issue_ids = {c.issue_id for c in mine}
        oldest = min(c.created_at for c in mine)
        others = (
            IssueComment.objects.filter(
                issue_id__in=issue_ids,
                created_at__gt=oldest,
                actor__is_bot=False,
            )
            .exclude(actor=request.user)
            .select_related("actor")
            .order_by("created_at")
        )
        others_by_issue = {}
        for o in others:
            others_by_issue.setdefault(o.issue_id, []).append(o)

        items = []
        for c in mine:
            later = [o for o in others_by_issue.get(c.issue_id, []) if o.created_at > c.created_at]
            reply = later[-1] if later else None
            items.append({
                "id": str(c.id),
                "issue_id": str(c.issue_id),
                "project_id": str(c.project_id),
                "project_identifier": c.project.identifier,
                "sequence_id": c.issue.sequence_id,
                "issue_name": c.issue.name,
                "comment_html": c.comment_html or "",
                "created_at": c.created_at,
                "reply": None if reply is None else {
                    "id": str(reply.id),
                    "actor_display": reply.actor.display_name or reply.actor.first_name or "",
                    "actor_avatar": reply.actor.avatar_url or "",
                    "comment_html": reply.comment_html or "",
                    "created_at": reply.created_at,
                },
                "is_last": reply is None,
            })
        return Response({"items": items, "has_more": has_more})
