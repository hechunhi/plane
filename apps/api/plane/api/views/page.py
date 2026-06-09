# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# BARSOUL 2026-06-09 (hechun): 外部 API(token-auth / X-Api-Key=愛ちゃん)で
#   Project Page を作成/削除する薄端点。CE の v1 公開 API には Pages が無い
#   ため、愛ちゃんの「（共有）」カード自動仕分け(ナレッジ化)に必要な最小限を
#   app 層 PageViewSet.create / destroy のロジックを踏襲して追加する。
#   - 作成: description_html のみで作れる(binary=None → live server が Yjs を
#     html から hydrate)。owned_by = request.user(= 愛ちゃん, APIKey 認証)。
#   - 削除: 自動生成ページの「撤回(undo)」専用。所有者(=愛ちゃん)のみ。
#   赤線: SoR 書込はこの端点 + 愛ちゃん token のみ(ADR-015)。permission は
#         既存 ProjectLitePermission を再利用、新規 permission は書かない。

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectLitePermission
from plane.app.serializers import PageSerializer
from plane.bgtasks.page_transaction_task import page_transaction
from plane.db.models import Page

from .base import BaseAPIView


class PageListCreateAPIEndpoint(BaseAPIView):
    """BARSOUL: 外部 API で Project Page を作成(愛ちゃん X-Api-Key)。

    body: {"name": "...", "description_html": "<p>...</p>"} (access 省略=Public)
    """

    permission_classes = [ProjectLitePermission]

    def post(self, request, slug, project_id):
        description_html = request.data.get("description_html", "<p></p>")
        serializer = PageSerializer(
            data=request.data,
            context={
                "project_id": project_id,
                "owned_by_id": request.user.id,  # = 愛ちゃん(APIKeyAuthentication)
                "description_json": request.data.get("description_json", {}),
                "description_binary": None,  # live server が html から hydrate
                "description_html": description_html,
            },
        )
        if serializer.is_valid():
            serializer.save()
            page_transaction.delay(
                new_description_html=description_html,
                old_description_html=None,
                page_id=serializer.data["id"],
            )
            page = Page.objects.get(pk=serializer.data["id"])
            # BARSOUL: ネスト — カテゴリ親ページの下に子ページとしてぶら下げる
            #   (Page tree は parent_id 駆動 / base.py:65 の再帰 CTE)。親が
            #   同プロジェクトに存在する場合のみ設定。
            parent_id = request.data.get("parent")
            if parent_id and Page.objects.filter(
                pk=parent_id, workspace__slug=slug, projects__id=project_id
            ).exists():
                page.parent_id = parent_id
                page.save(update_fields=["parent"])
            return Response(
                {
                    "id": str(page.id),
                    "name": page.name,
                    "project_id": str(project_id),
                    "workspace_slug": slug,
                    "parent_id": (str(page.parent_id) if page.parent_id else None),
                },
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PageDetailAPIEndpoint(BaseAPIView):
    """BARSOUL: 外部 API で Page を削除(自動仕分けの撤回専用, 愛ちゃん)。

    所有者(= 愛ちゃん)のページのみ削除可。自動生成ページの undo に使う。
    """

    permission_classes = [ProjectLitePermission]

    def delete(self, request, slug, project_id, page_id):
        try:
            page = Page.objects.get(
                pk=page_id, workspace__slug=slug, projects__id=project_id
            )
        except Page.DoesNotExist:
            return Response(
                {"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND
            )
        # 自動生成ページ(= 愛ちゃん所有)のみ、この端点経由で削除可
        if str(page.owned_by_id) != str(request.user.id):
            return Response(
                {"error": "Only the owner can delete via this endpoint"},
                status=status.HTTP_403_FORBIDDEN,
            )
        # 子ページの親リンクを外す(app destroy と同じ不変式)
        Page.objects.filter(
            parent_id=page_id, projects__id=project_id, workspace__slug=slug
        ).update(parent=None)
        page.delete()  # SoftDeleteModel → deleted_at 設定
        return Response(status=status.HTTP_204_NO_CONTENT)

    def put(self, request, slug, project_id, page_id):
        """BARSOUL: ページ本文(description_html)を丸ごと差し替え(愛ちゃん所有のみ)。
        共有ナレッジの月次ログを「愛ちゃんが自分の台帳から毎回再生成 → 全文 PUT」
        するために使う。description_binary=None にリセットし、live server が
        新しい html から Yjs を再 hydrate するようにする(編集中の手動編集は
        上書きされる前提 = 自動維持ページ)。"""
        try:
            page = Page.objects.get(
                pk=page_id, workspace__slug=slug, projects__id=project_id
            )
        except Page.DoesNotExist:
            return Response(
                {"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND
            )
        if str(page.owned_by_id) != str(request.user.id):
            return Response(
                {"error": "Only the owner can update via this endpoint"},
                status=status.HTTP_403_FORBIDDEN,
            )
        new_html = request.data.get("description_html")
        if new_html is None:
            return Response(
                {"error": "description_html required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        old_html = page.description_html
        page.description_html = new_html
        page.description_binary = None  # live server が html から再 hydrate
        if "name" in request.data:
            page.name = request.data.get("name") or page.name
        page.save(update_fields=["description_html", "description_binary", "name"])
        page_transaction.delay(
            new_description_html=new_html,
            old_description_html=old_html,
            page_id=str(page.id),
        )
        return Response({"id": str(page.id)}, status=status.HTTP_200_OK)
