# Copyright (c) 2026 BARSOUL customizations
# C1: Plane ↔ keiri 単据反链。Plane の課題(受注/案件)詳細から、その案件に
# 紐づく keiri の受注ステータス・請求書(単票)へワンクリックで辿れるよう、
# Plane バックエンド経由で keiri-api を内網プロキシする。
#
# セキュリティ境界の理由:
#   tasks.barsoul.jp は Caddy 層で Authelia を通していない（Plane 自前ログイン）。
#   そのため Caddy 直プロキシだと財務データを無認証で晒す。ここで Plane の
#   セッション認証 + ワークスペース所属チェックを通したユーザーだけが、
#   サーバ側から内網の keiri-api を Remote-User 付きで叩ける形にする
#   （ai-bot と同じ Remote-User 信頼方式を踏襲）。
import os

import requests
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import WorkspaceViewerPermission
from plane.app.views.base import BaseAPIView

# keiri-api 内網ベース（host 公開ポート経由がデフォルト。env で上書き可）。
KEIRI_API_BASE = os.environ.get("KEIRI_API_BASE", "http://host.docker.internal:8099")
# 公開URL（ブラウザが開くリンクのプレフィックス）。
KEIRI_PUBLIC = os.environ.get("KEIRI_PUBLIC", "https://keiri.barsoul.jp")


class KeiriOrderEndpoint(BaseAPIView):
    """GET /api/workspaces/<slug>/keiri-order/<issue_id>/

    返回（フロントのウィジェット用に整形済み）:
      未連携 / keiri 到達不可: {"linked": false}
      連携あり: {
        "linked": true,
        "order": {order_id, customer, date, status, cny, jpy},
        "documents": [{doc_type, status, url}],
        "order_url": "<keiri 公開URL>"
      }
    どんな失敗でも SPA を壊さない（linked:false を返す）。
    """

    permission_classes = [WorkspaceViewerPermission]

    def get(self, request, slug, issue_id):
        headers = {"Remote-User": getattr(request.user, "email", "") or "plane"}
        try:
            r = requests.get(
                f"{KEIRI_API_BASE}/api/orders/by-plane/{issue_id}",
                headers=headers,
                timeout=6,
            )
        except requests.RequestException:
            return Response({"linked": False}, status=status.HTTP_200_OK)

        if r.status_code == 404:
            return Response({"linked": False}, status=status.HTTP_200_OK)
        if r.status_code != 200:
            return Response({"linked": False}, status=status.HTTP_200_OK)

        try:
            order = r.json()
        except ValueError:
            return Response({"linked": False}, status=status.HTTP_200_OK)

        order_id = order.get("order_id")
        documents = []
        if order_id:
            try:
                dr = requests.get(
                    f"{KEIRI_API_BASE}/api/order-docs/{order_id}",
                    headers=headers,
                    timeout=6,
                )
                if dr.status_code == 200:
                    for d in (dr.json() or {}).get("documents", []) or []:
                        link = d.get("link") or ""
                        documents.append(
                            {
                                "doc_type": d.get("doc_type"),
                                "status": d.get("status"),
                                "url": f"{KEIRI_PUBLIC}{link}" if link else None,
                            }
                        )
            except (requests.RequestException, ValueError):
                pass  # 単票が取れなくても受注ステータスは出す

        return Response(
            {
                "linked": True,
                "order": {
                    "order_id": order_id,
                    "customer": order.get("customer"),
                    "date": order.get("date"),
                    "status": order.get("status"),
                    "cny": order.get("cny"),
                    "jpy": order.get("jpy"),
                },
                "documents": documents,
                "order_url": f"{KEIRI_PUBLIC}/?order={order_id}" if order_id else KEIRI_PUBLIC,
            },
            status=status.HTTP_200_OK,
        )
