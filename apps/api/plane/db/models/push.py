# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
BARSOUL 2026-08 — Web Push(ブラウザ標準のプッシュ通知)の保存先。

既存の `Device` / `DeviceSession` は FCM 前提(`push_token` 1 本)で、
Web Push が要求する endpoint + p256dh + auth の 3 点セットが入らない。
また endpoint は URL なので 255 文字に収まらない端末がある。
なので別テーブルを立てる。`Device` 側には一切手を入れない。
"""

from django.conf import settings
from django.db import models

from .base import BaseModel


class WebPushSubscription(BaseModel):
    """1 レコード = 1 ブラウザ(= 1 端末)。

    同じ人が iPhone・iPad・会社の Windows Chrome・Mac を同時に登録する前提。
    「1 ユーザー 1 端末」を絶対に仮定しない。
    endpoint がブラウザ側の一意キーなので、こちらも endpoint を unique にして
    「同じ端末から再購読された」= 上書き(update_or_create)で扱う。

    ⚠ このテーブルは **論理削除してはいけない**。
    BaseModel は deleted_at 付きのソフトデリートだが、DB の unique 制約は
    deleted_at を見ない。一度ソフト削除すると同じ endpoint で二度と登録できず、
    「通知を切って、また入れ直したら永久に 400」になる。
    削除する時は必ず `delete(soft=False)`(= ハードデリート)を使う。
    そもそも通常の OFF は `is_active=False` で表すので、削除自体が稀。
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="web_push_subscriptions",
    )
    # ブラウザが払い出すプッシュサーバの URL。長いので TextField。
    endpoint = models.TextField(unique=True)
    # 本文を暗号化するための公開鍵と認証シークレット。
    p256dh = models.TextField()
    auth = models.TextField()

    # どの端末か人間が見て分かるように(設定画面に「iPhone の Safari」等で出す)
    user_agent = models.TextField(blank=True, default="")
    device_label = models.CharField(max_length=255, blank=True, default="")
    # ホーム画面に追加した PWA から登録されたか(iOS はこれが必須条件)
    is_standalone = models.BooleanField(default=False)

    # 送信可否。ユーザーが OFF にした / 宛先が死んだ場合に False。
    is_active = models.BooleanField(default=True)
    # 送信が連続で失敗した回数。404/410 は即 is_active=False にするのでこれは
    # 一時的なネットワークエラー用のカウンタ。
    failure_count = models.PositiveIntegerField(default=0)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "web_push_subscriptions"
        verbose_name = "Web Push Subscription"
        verbose_name_plural = "Web Push Subscriptions"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["user", "is_active"], name="wps_user_active_idx")]

    def __str__(self):
        return f"{self.user_id} · {self.device_label or 'device'}"


class WebPushPreference(BaseModel):
    """通知の種類ごとの ON/OFF。ユーザーに 1 行。

    既存の `UserNotificationPreference` はメール通知向けの意味付けが済んでいて、
    「アプリ内通知は要るがプッシュは要らない」を表現できない。混ぜると
    片方を切ったつもりでもう片方まで消える事故になるので分ける。
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="web_push_preference",
    )
    mention = models.BooleanField(default=True)
    comment_reply = models.BooleanField(default=True)
    assigned = models.BooleanField(default=True)
    deadline = models.BooleanField(default=True)
    important_update = models.BooleanField(default=True)

    class Meta:
        db_table = "web_push_preferences"
        verbose_name = "Web Push Preference"
        verbose_name_plural = "Web Push Preferences"

    def __str__(self):
        return str(self.user_id)
