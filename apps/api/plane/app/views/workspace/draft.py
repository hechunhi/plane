# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import html as html_lib
import json

# Django imports
from django.utils import timezone
from django.core import serializers
from django.core.serializers.json import DjangoJSONEncoder
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, Subquery, OuterRef, Min, Max
from django.db.models.functions import Coalesce
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import (
    IssueCreateSerializer,
    DraftIssueCreateSerializer,
    DraftIssueSerializer,
    DraftIssueDetailSerializer,
)
from plane.db.models import (
    Issue,
    DraftIssue,
    CycleIssue,
    ModuleIssue,
    DraftIssueCycle,
    Workspace,
    FileAsset,
)
from .. import BaseViewSet

from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_filters import issue_filters
from plane.utils.host import base_host


class WorkspaceDraftIssueViewSet(BaseViewSet):
    model = DraftIssue

    def get_queryset(self):
        return (
            DraftIssue.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "draft_issue_module__module")
            .annotate(
                cycle_id=Subquery(
                    DraftIssueCycle.objects.filter(draft_issue=OuterRef("id"), deleted_at__isnull=True).values(
                        "cycle_id"
                    )[:1]
                )
            )
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & (Q(draft_label_issue__deleted_at__isnull=True))),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(draft_issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    ArrayAgg(
                        "draft_issue_module__module_id",
                        distinct=True,
                        filter=Q(
                            ~Q(draft_issue_module__module_id__isnull=True)
                            & Q(draft_issue_module__module__archived_at__isnull=True)
                            & Q(draft_issue_module__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
        ).distinct()

    @method_decorator(gzip_page)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        filters = issue_filters(request.query_params, "GET")
        issues = self.get_queryset().filter(created_by=request.user)

        # BARSOUL 2026-08: 個人 ToDo の「済」を既定で外す。
        # `?done=true` を付けた時だけ「完了した N 件」の引き出しを返す。
        # 既定を「未完のみ」にしておくのが肝 —— 引き出しを開けない限り
        # 一覧は必ず「今やること」だけになる(=空にできる)。
        is_done_drawer = str(request.query_params.get("done", "")).lower() in ("true", "1")
        if is_done_drawer:
            issues = issues.filter(done_at__isnull=False).order_by("-done_at")
        else:
            # 個人の並び順が第一。todo_order 未設定(既定 65535)の既存行は
            # 同値で並ぶので、第二キーの created_at 降順 = 従来の見え方に退化する。
            issues = issues.filter(done_at__isnull=True).order_by("todo_order", "-created_at")

        issues = issues.filter(**filters)

        # BARSOUL 2026-08: **親だけをページに載せる**。子タスクはページ枠を食わない。
        # こうしないと「50 件」の大半が子で埋まり、親が次ページに落ちて
        # 木が千切れる(親の居ない子だけが降ってくる)。
        issues = issues.filter(todo_parent__isnull=True)

        def _with_children(page_roots):
            roots = list(page_roots)
            if not roots:
                return []
            # 子は done で絞らない。畳んだ親を開いた時、済んだ子も
            # 取り消し線付きで残っていないと「消えた」に見える。
            children = (
                self.get_queryset()
                .filter(created_by=request.user, todo_parent_id__in=[root.id for root in roots])
                .order_by("todo_order", "created_at")
            )
            return DraftIssueSerializer(roots + list(children), many=True).data

        # List Paginate
        return self.paginate(request=request, queryset=(issues), on_results=_with_children)

    def _next_todo_order(self, request, workspace, todo_parent_id):
        """新しい行を置く場所。親は一番上、子は一番下。

        親(トップレベル)は「今思いついた事」なので一番上に積む。子タスクは
        親を分解していく作業なので、書いた順に下へ伸びる方が読める。
        1000 刻みなのは、間に落とす並べ替え(中点を取る)を何度やっても
        float の刻みが尽きないため。
        """
        siblings = DraftIssue.objects.filter(
            workspace=workspace, created_by=request.user, todo_parent_id=todo_parent_id
        )
        if todo_parent_id:
            edge = siblings.aggregate(v=Max("todo_order"))["v"]
            return (edge if edge is not None else 0) + 1000
        edge = siblings.aggregate(v=Min("todo_order"))["v"]
        return (edge if edge is not None else 0) - 1000

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        # 並び順は原則サーバが決める(端末間でぶれない)。ドラッグ並べ替えの時
        # だけフロントが中点を計算して明示的に送ってくるので、それは尊重する。
        data = {key: value for key, value in request.data.items()}
        if data.get("todo_order") is None:
            data["todo_order"] = self._next_todo_order(request, workspace, data.get("todo_parent_id") or None)

        serializer = DraftIssueCreateSerializer(
            data=data,
            context={
                "workspace_id": workspace.id,
                "project_id": request.data.get("project_id", None),
            },
        )
        if serializer.is_valid():
            serializer.save()
            issue = (
                self.get_queryset()
                .filter(pk=serializer.data.get("id"))
                .values(
                    "id",
                    "name",
                    "state_id",
                    "sort_order",
                    "completed_at",
                    "estimate_point",
                    "priority",
                    "start_date",
                    "target_date",
                    "project_id",
                    "parent_id",
                    "cycle_id",
                    "module_ids",
                    "label_ids",
                    "assignee_ids",
                    "created_at",
                    "updated_at",
                    "created_by",
                    "updated_by",
                    "type_id",
                    "description_html",
                    # BARSOUL 2026-08: 個人 ToDo の列。フロントは作成直後の 1 行を
                    # そのままストアに差し込むので、ここに無い列は「無い」ことになる。
                    "done_at",
                    "todo_parent_id",
                    "memo",
                    "todo_order",
                )
                .first()
            )

            return Response(issue, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # BARSOUL 2026-08: creator ショートカットの model が Issue だった。下書きの
    # pk は Issue には存在しないので、この分岐は一度も通らず「自分の下書きなのに
    # 直せない」(GUEST は特に)状態だった。見る先を DraftIssue に直す。
    # 併せて view 側でも created_by=request.user で絞っているので、他人の下書きには
    # 届かない。
    @allow_permission(
        allowed_roles=[ROLE.ADMIN, ROLE.MEMBER],
        creator=True,
        model=DraftIssue,
        level="WORKSPACE",
    )
    def partial_update(self, request, slug, pk):
        issue = self.get_queryset().filter(pk=pk, created_by=request.user).first()

        if not issue:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        project_id = request.data.get("project_id", issue.project_id)

        serializer = DraftIssueCreateSerializer(
            issue,
            data=request.data,
            partial=True,
            context={
                "project_id": project_id,
                "cycle_id": request.data.get("cycle_id", "not_provided"),
            },
        )

        if serializer.is_valid():
            serializer.save()

            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # 同上。自分の下書きは自分で読める(ADMIN 以外も)。
    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=DraftIssue, level="WORKSPACE")
    def retrieve(self, request, slug, pk=None):
        issue = self.get_queryset().filter(pk=pk, created_by=request.user).first()

        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = DraftIssueDetailSerializer(issue)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=DraftIssue, level="WORKSPACE")
    def destroy(self, request, slug, pk=None):
        draft_issue = DraftIssue.objects.get(workspace__slug=slug, pk=pk)
        draft_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _fold_todo_into_description(draft_issue, description_html):
        """メモと子タスクを、本文の末尾に畳み込む。

        プロジェクトへ移す時、下書き行は消える(子は CASCADE で道連れ)。
        メモも子タスクも **個人側にしか無い情報** なので、ここで本文へ移さないと
        黙って消える。子タスクはエディタのチェックリスト(taskList)にして、
        移した先でもそのままチェックを続けられる形で残す。
        """
        parts = [description_html or ""]

        memo = (draft_issue.memo or "").strip()
        if memo:
            # 引用ブロックにするのは、見出しの語(「メモ」/「备注」)をサーバ側で
            # 決めずに済ませるため。日本語と中国語が混ざるチームで、片方の言語だけが
            # 本文に焼き付くのは避けたい。囲みの形なら、どの言語でも同じに読める。
            body = "<br/>".join(html_lib.escape(line) for line in memo.splitlines())
            parts.append(f"<p></p><blockquote><p>{body}</p></blockquote>")

        children = list(draft_issue.todo_children.order_by("todo_order", "created_at"))
        if children:
            items = "".join(
                '<li data-type="taskItem" data-checked="{checked}"><p>{name}</p></li>'.format(
                    checked="true" if child.done_at else "false",
                    name=html_lib.escape(child.name or ""),
                )
                for child in children
            )
            parts.append(f'<p></p><ul data-type="taskList">{items}</ul>')

        return "".join(parts)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create_draft_to_issue(self, request, slug, draft_id):
        draft_issue = self.get_queryset().filter(pk=draft_id).first()

        if not draft_issue.project_id:
            return Response(
                {"error": "Project is required to create an issue."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # メモと子タスクを本文の末尾へ。ここを通さないと draft_issue.delete() で
        # 子が CASCADE で消え、個人側にしか無かった情報が黙って失われる。
        data = {key: value for key, value in request.data.items()}
        data["description_html"] = self._fold_todo_into_description(
            draft_issue, data.get("description_html") or draft_issue.description_html
        )

        serializer = IssueCreateSerializer(
            data=data,
            context={
                "project_id": draft_issue.project_id,
                "workspace_id": draft_issue.project.workspace_id,
                "default_assignee_id": draft_issue.project.default_assignee_id,
            },
        )

        if serializer.is_valid():
            serializer.save()

            issue_activity.delay(
                type="issue.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(serializer.data.get("id", None)),
                project_id=str(draft_issue.project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )

            if request.data.get("cycle_id", None):
                created_records = CycleIssue.objects.create(
                    cycle_id=request.data.get("cycle_id", None),
                    issue_id=serializer.data.get("id", None),
                    project_id=draft_issue.project_id,
                    workspace_id=draft_issue.workspace_id,
                    created_by_id=draft_issue.created_by_id,
                    updated_by_id=draft_issue.updated_by_id,
                )
                # Capture Issue Activity
                issue_activity.delay(
                    type="cycle.activity.created",
                    requested_data=None,
                    actor_id=str(self.request.user.id),
                    issue_id=None,
                    project_id=str(self.kwargs.get("project_id", None)),
                    current_instance=json.dumps(
                        {
                            "updated_cycle_issues": None,
                            "created_cycle_issues": serializers.serialize("json", [created_records]),
                        }
                    ),
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )

            if request.data.get("module_ids", []):
                # bulk create the module
                ModuleIssue.objects.bulk_create(
                    [
                        ModuleIssue(
                            module_id=module,
                            issue_id=serializer.data.get("id", None),
                            workspace_id=draft_issue.workspace_id,
                            project_id=draft_issue.project_id,
                            created_by_id=draft_issue.created_by_id,
                            updated_by_id=draft_issue.updated_by_id,
                        )
                        for module in request.data.get("module_ids", [])
                    ],
                    batch_size=10,
                )
                # Update the activity
                _ = [
                    issue_activity.delay(
                        type="module.activity.created",
                        requested_data=json.dumps({"module_id": str(module)}),
                        actor_id=str(request.user.id),
                        issue_id=serializer.data.get("id", None),
                        project_id=draft_issue.project_id,
                        current_instance=None,
                        epoch=int(timezone.now().timestamp()),
                        notification=True,
                        origin=base_host(request=request, is_app=True),
                    )
                    for module in request.data.get("module_ids", [])
                ]

            # Update file assets
            file_assets = FileAsset.objects.filter(draft_issue_id=draft_id)
            file_assets.update(
                issue_id=serializer.data.get("id", None),
                entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
                draft_issue_id=None,
            )

            # delete the draft issue
            draft_issue.delete()

            return Response(serializer.data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
