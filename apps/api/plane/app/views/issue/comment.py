# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import Exists
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueCommentSerializer, CommentReactionSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueComment, ProjectMember, CommentReaction, Project, Issue, CommentTranslation
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host
from plane.bgtasks.webhook_task import model_activity, webhook_activity
# BARSOUL: lazy translate (X-style 即点即译)
import os
import re
import requests as _req
from .. import BaseAPIView


class IssueCommentViewSet(BaseViewSet):
    serializer_class = IssueCommentSerializer
    model = IssueComment
    webhook_event = "issue_comment"

    filterset_fields = ["issue__id", "workspace__id"]

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("issue")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"),
                        project_id=self.kwargs.get("project_id"),
                        member_id=self.request.user.id,
                        is_active=True,
                    )
                )
            )
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, issue_id):
        project = Project.objects.get(pk=project_id)
        issue = Issue.objects.get(pk=issue_id)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to comment on the issue"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = IssueCommentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id, actor=request.user)
            issue_activity.delay(
                type="comment.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(serializer.data["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def partial_update(self, request, slug, project_id, issue_id, pk):
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        serializer = IssueCommentSerializer(issue_comment, data=request.data, partial=True)
        if serializer.is_valid():
            if "comment_html" in request.data and request.data["comment_html"] != issue_comment.comment_html:
                serializer.save(edited_at=timezone.now())
            else:
                serializer.save()
            issue_activity.delay(
                type="comment.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(pk),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def destroy(self, request, slug, project_id, issue_id, pk):
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        issue_comment.delete()
        issue_activity.delay(
            type="comment.activity.deleted",
            requested_data=json.dumps({"comment_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        # BARSOUL realtime: Plane CE のコメント destroy は webhook 未発火
        #   (create/partial_update は model_activity 発火) → 他窓口で
        #   削除コメントが消えない。create/update と同じ issue_comment
        #   webhook に乗せる。deleted は対象が消えるので親 issue を明示
        #   付与 → ai-bot _ct_pub が data["issue"] で対象特定 → 開いてる
        #   パネルのみ comment store を全再取得(削除/編集も反映)。
        webhook_activity.delay(
            event="issue_comment",
            verb="deleted",
            field=None,
            old_value=None,
            new_value=None,
            actor_id=str(request.user.id),
            slug=slug,
            current_site=base_host(request=request, is_app=True),
            event_id=str(pk),
            old_identifier=None,
            new_identifier=None,
            project_id=str(project_id),
            parent_issue_id=str(issue_id),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# BARSOUL: X-style 即点即译 — cookie auth, project member, lazy LLM gateway.
# 缓存命中 → 即刻返;缓存未命中 → 调 LLM 网关 → upsert 派生表 → 返。
# ai-bot autotranslate 仍在后台预热缓存(写入時),大多数点击会命中。
_HTML_STRIP = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_HK_RE = re.compile(r"[぀-ゟ゠-ヿ]")  # ひらがな/カタカナ
_HAN_RE = re.compile(r"[一-鿿]")


def _strip(h):
    return _WS.sub(" ", _HTML_STRIP.sub(" ", h or "")).strip()


def _detect_src(text):
    """Return source lang code or None."""
    if _HK_RE.search(text):
        return "ja"
    if _HAN_RE.search(text):
        return "zh"
    return None


def _call_llm(text, src, tgt):
    """Call LLM gateway with simple translation prompt. Returns translated str."""
    url = os.environ.get("LLM_GATEWAY_URL", "").strip()
    if not url:
        return ""
    src_label = "日本語" if src == "ja" else ("中文" if src == "zh" else src)
    tgt_label = "中文（簡体字）" if tgt == "zh" else ("日本語" if tgt == "ja" else tgt)
    # BARSOUL 2026-05-24:hy-mt2 (Hy-MT2-1.8B-mlx-q4) 在专有名词 + 数字 + 英文密度高的输入上
    # 会直接 punt 复述原文(no-op 失败)。实测加强制指令 + 显式保持规则后稳定性 50% → 100%
    # (P1 prompt 三轮 6/6 case 全通过)。
    sys = (
        f"あなたは越境EC企業 BARSOUL(大阪・日中チーム)の業務翻訳者。"
        f"**必須**: 入力された{src_label}を{tgt_label}に翻訳して出力する。"
        "原文をそのまま返してはならない。原文と異なる訳文を必ず出力する。\n"
        "規則:\n"
        f"- 出力は{tgt_label}の翻訳文のみ(前置き・引用符・原文併記なし)\n"
        "- 人名 / 電話番号 / 住所固有名 / 英語ブランド名(例 Shaken Not Stirred) / 数値 / 日付 / 金額 は保持\n"
        "- 内容が短くても必ず翻訳する。コピーは禁止。"
    )
    try:
        # BARSOUL: 翻译専用モデル hy-mt2 (Hy-MT2-1.8B-mlx-q4 via gateway:8200)
        # ~505ms vs 通用モデル ~2s; 翻訳品質同等以上。
        r = _req.post(
            url,
            json={
                "model": "hy-mt2",
                "messages": [
                    {"role": "system", "content": sys},
                    {"role": "user", "content": text[:1500]},
                ],
                "temperature": 0.2,
                "max_tokens": 1500,
            },
            timeout=60,
        )
        if r.status_code != 200:
            return ""
        j = r.json()
        msg = ((j.get("choices") or [{}])[0] or {}).get("message", {}) or {}
        out = (msg.get("content") or "").strip()
        # strip common preambles
        for p in ("【", "訳:", "翻訳:", "译文:", "中文:", "日本語:"):
            if out.startswith(p) and "\n" in out:
                out = out.split("\n", 1)[1].strip()
        return out
    except Exception:
        return ""


class CommentTranslateOnDemandEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/comments/{cid}/translate/
    Body: {target_lang: "zh"|"ja"}
    Cookie auth (Plane session)。缓存命中即返,未命中 LLM + upsert。
    继承 BaseAPIView → 自带 session auth + IsAuthenticated;
    @allow_permission([ADMIN,MEMBER,GUEST]) = 项目成员都可触发翻译。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id, comment_id):
        try:
            comment = IssueComment.objects.get(
                pk=comment_id, workspace__slug=slug,
                project_id=project_id, issue_id=issue_id,
            )
        except IssueComment.DoesNotExist:
            return Response({"error": "comment not found"}, status=status.HTTP_404_NOT_FOUND)

        target_lang = (request.data or {}).get("target_lang", "").strip().lower()[:8]
        if not target_lang:
            return Response({"error": "target_lang required"}, status=status.HTTP_400_BAD_REQUEST)

        # Cache hit (含 soft-deleted 复活)
        cache = CommentTranslation.all_objects.filter(
            comment=comment, target_lang=target_lang
        ).first()
        if cache and not cache.deleted_at and cache.text:
            return Response({
                "text": cache.text, "source_lang": cache.source_lang,
                "by": cache.translated_by, "cached": True,
            })

        # Cache miss → LLM
        src_text = _strip(comment.comment_html or "")
        if not src_text:
            return Response({"error": "empty source"}, status=status.HTTP_400_BAD_REQUEST)
        src = _detect_src(src_text) or "auto"
        translated = _call_llm(src_text, src, target_lang)
        if not translated:
            return Response({"error": "translation failed"}, status=status.HTTP_502_BAD_GATEWAY)

        if cache:  # revive soft-deleted
            cache.text = translated
            cache.source_lang = src if src != "auto" else cache.source_lang
            cache.translated_by = "ondemand"
            cache.deleted_at = None
            cache.updated_by_id = request.user.id
            cache.save()
        else:
            CommentTranslation.objects.create(
                comment=comment, target_lang=target_lang,
                project_id=project_id, workspace_id=comment.workspace_id,
                text=translated, source_lang=src,
                translated_by="ondemand",
                created_by_id=request.user.id, updated_by_id=request.user.id,
            )
        return Response({
            "text": translated, "source_lang": src,
            "by": "ondemand", "cached": False,
        })


class CommentReactionViewSet(BaseViewSet):
    serializer_class = CommentReactionSerializer
    model = CommentReaction

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(comment_id=self.kwargs.get("comment_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .order_by("-created_at")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, comment_id):
        try:
            serializer = CommentReactionSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(
                    project_id=project_id,
                    actor_id=request.user.id,
                    comment_id=comment_id,
                )
                issue_activity.delay(
                    type="comment_reaction.activity.created",
                    requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                    actor_id=str(request.user.id),
                    issue_id=None,
                    project_id=str(project_id),
                    current_instance=None,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "Reaction already exists for the user"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def destroy(self, request, slug, project_id, comment_id, reaction_code):
        comment_reaction = CommentReaction.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            comment_id=comment_id,
            reaction=reaction_code,
            actor=request.user,
        )
        issue_activity.delay(
            type="comment_reaction.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "reaction": str(reaction_code),
                    "identifier": str(comment_reaction.id),
                    "comment_id": str(comment_id),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        comment_reaction.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
