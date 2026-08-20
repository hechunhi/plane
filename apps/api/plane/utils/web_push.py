# BARSOUL 2026-08 — Web Push の送信口。ここ以外から pywebpush を直接呼ばない。
#
# 役割は 3 つだけ:
#   1. VAPID の設定を読む(未設定なら「機能ごと無効」として静かに落とす)
#   2. 1 件の購読先に 1 通送る
#   3. 送信結果で購読レコードの寿命を管理する(404/410 = 宛先が死んだ → 無効化)
#
# 文面の組み立てや「誰に送るか」はここには置かない(bgtasks/web_push_task.py の仕事)。

import json
import logging
import os

from django.utils import timezone

logger = logging.getLogger(__name__)

# 送信先が「もう存在しない」ことを示す HTTP ステータス。
# 404 = そんな購読は無い / 410 = 期限切れ。どちらも再試行しても永久に無駄なので
# 即座に購読を無効化する。それ以外(500, タイムアウト等)は相手側の一時障害と見なし、
# レコードは残したまま失敗回数だけ数える。
_DEAD_STATUSES = (404, 410)

# 一時障害がこの回数続いたら、さすがに壊れているとみなして無効化する。
_MAX_FAILURES = 10

# プッシュサービス側に「この通知は何秒持ち回ってよいか」を伝える値。
# 端末が圏外でも 24h は保持してもらう(翌日出社して初めて受け取る、を許す)。
_TTL_SECONDS = 60 * 60 * 24


def vapid_public_key() -> str:
    """フロントに渡す公開鍵。空文字なら「この環境ではプッシュ未設定」。"""
    return os.environ.get("VAPID_PUBLIC_KEY", "").strip()


def _vapid_private_key() -> str:
    return os.environ.get("VAPID_PRIVATE_KEY", "").strip()


def _vapid_subject() -> str:
    # RFC 8292 は連絡先(mailto: か https:)を要求する。プッシュサービスが
    # 配信を止めた時にこちらへ連絡するための宛先で、ユーザーには見えない。
    return os.environ.get("VAPID_SUBJECT", "").strip() or "mailto:admin@barsoul.jp"


def is_configured() -> bool:
    """鍵が両方揃っているか。揃っていなければ送信系は全て no-op になる。"""
    return bool(vapid_public_key() and _vapid_private_key())


def send_to_subscription(subscription, payload: dict) -> bool:
    """購読 1 件に 1 通送る。送れたら True。

    例外は投げない。プッシュはあくまで「おまけの経路」で、アプリ内通知(ベル)は
    別途必ず作られている。ここで落ちて通知作成そのものを巻き添えにしてはいけない。
    """
    if not is_configured():
        return False

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:  # pragma: no cover - 依存が入っていない環境向けの保険
        logger.warning("pywebpush is not installed; web push disabled")
        return False

    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=_vapid_private_key(),
            vapid_claims={"sub": _vapid_subject()},
            ttl=_TTL_SECONDS,
            timeout=10,
        )
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in _DEAD_STATUSES:
            # 宛先が消えた。ハードデリートではなく無効化に留めるのは、
            # 「いつどの端末が落ちたか」を後から追えるようにするため。
            _deactivate(subscription, reason=f"HTTP {status}")
        else:
            _count_failure(subscription, reason=str(status or exc))
        return False
    except Exception as exc:  # ネットワーク断・DNS 失敗など
        _count_failure(subscription, reason=repr(exc))
        return False

    subscription.failure_count = 0
    subscription.last_used_at = timezone.now()
    subscription.save(
        update_fields=["failure_count", "last_used_at", "updated_at"],
        disable_auto_set_user=True,
    )
    return True


def _deactivate(subscription, reason: str) -> None:
    subscription.is_active = False
    subscription.save(update_fields=["is_active", "updated_at"], disable_auto_set_user=True)
    logger.info("web push subscription deactivated (%s): %s", reason, subscription.id)


def _count_failure(subscription, reason: str) -> None:
    subscription.failure_count = (subscription.failure_count or 0) + 1
    fields = ["failure_count", "updated_at"]
    if subscription.failure_count >= _MAX_FAILURES:
        subscription.is_active = False
        fields.append("is_active")
        logger.info("web push subscription retired after %s failures: %s", subscription.failure_count, subscription.id)
    subscription.save(update_fields=fields, disable_auto_set_user=True)
    logger.debug("web push send failed (%s): %s", reason, subscription.id)
