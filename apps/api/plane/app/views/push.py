# BARSOUL 2026-08 — スマホのプッシュ通知の登録・解除・設定 API。
#
# セキュリティの前提(ここを崩さない):
#   - 全て「ログイン中の本人」に固定して読み書きする。URL にユーザー ID は取らない。
#     他人の購読を登録することも消すこともできない構造にする。
#   - 通知の中身はこの API では返さない。閲覧権限の判定は通知作成側(既存の
#     Notification 生成経路)で既に済んでいるものだけを流す。
#   - クリック後の画面は普通のページなので、権限が無ければ既存の権限判定で弾かれる。
#     プッシュが届いた = 見られる、ではない。

from rest_framework import status
from rest_framework.response import Response

from plane.db.models import WebPushPreference, WebPushSubscription
from plane.utils.web_push import is_configured, vapid_public_key

from .base import BaseAPIView

_PREFERENCE_FIELDS = ("mention", "comment_reply", "assigned", "deadline", "important_update")


class PushConfigEndpoint(BaseAPIView):
    """フロントが購読を作るのに要る公開鍵。秘密鍵は絶対に出さない。"""

    def get(self, request):
        return Response(
            {"enabled": is_configured(), "vapid_public_key": vapid_public_key()},
            status=status.HTTP_200_OK,
        )


class PushSubscriptionEndpoint(BaseAPIView):
    """端末ごとの購読先。1 ユーザーが何台持っていてもよい。"""

    def get(self, request):
        subscriptions = WebPushSubscription.objects.filter(user=request.user).order_by("-created_at")
        return Response(
            [
                {
                    "id": str(s.id),
                    "device_label": s.device_label,
                    "is_standalone": s.is_standalone,
                    "is_active": s.is_active,
                    "created_at": s.created_at,
                    "last_used_at": s.last_used_at,
                }
                for s in subscriptions
            ],
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        endpoint = (request.data.get("endpoint") or "").strip()
        keys = request.data.get("keys") or {}
        p256dh = (keys.get("p256dh") or "").strip()
        auth = (keys.get("auth") or "").strip()

        if not (endpoint and p256dh and auth):
            return Response({"error": "Invalid subscription"}, status=status.HTTP_400_BAD_REQUEST)

        # 同じ endpoint が既にあれば必ず上書きする。
        # 端末を家族と共有していたり、退職者の端末に別の人がログインし直した場合、
        # ブラウザは同じ endpoint を返してくる。ここで持ち主を今のログイン者に
        # 付け替えないと、前の持ち主宛の通知がその端末に鳴り続ける。
        WebPushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                "user": request.user,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": (request.data.get("user_agent") or "")[:1000],
                "device_label": (request.data.get("device_label") or "")[:255],
                "is_standalone": bool(request.data.get("is_standalone")),
                "is_active": True,
                "failure_count": 0,
            },
        )

        # 設定行が無ければここで作る(既定は全部 ON)。
        WebPushPreference.objects.get_or_create(user=request.user)
        return Response({"status": "subscribed"}, status=status.HTTP_200_OK)

    def delete(self, request):
        endpoint = (request.data.get("endpoint") or "").strip()
        queryset = WebPushSubscription.objects.filter(user=request.user)
        if endpoint:
            queryset = queryset.filter(endpoint=endpoint)

        # 論理削除は使わない。endpoint に一意制約があるので、論理削除すると
        # 同じ端末で二度と登録し直せなくなる(「切って、また入れ直す」が壊れる)。
        queryset.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PushPreferenceEndpoint(BaseAPIView):
    """種類ごとの ON/OFF。設定画面のスイッチ 5 個。"""

    def get(self, request):
        preference, _ = WebPushPreference.objects.get_or_create(user=request.user)
        return Response(self._as_dict(preference), status=status.HTTP_200_OK)

    def patch(self, request):
        preference, _ = WebPushPreference.objects.get_or_create(user=request.user)
        changed = []
        for field in _PREFERENCE_FIELDS:
            if field in request.data:
                setattr(preference, field, bool(request.data.get(field)))
                changed.append(field)
        if changed:
            preference.save(update_fields=changed + ["updated_at"])
        return Response(self._as_dict(preference), status=status.HTTP_200_OK)

    @staticmethod
    def _as_dict(preference):
        return {field: getattr(preference, field) for field in _PREFERENCE_FIELDS}
