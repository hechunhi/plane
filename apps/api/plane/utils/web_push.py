# BARSOUL 2026-08 — Web Push の送信口。ここ以外から pywebpush を直接呼ばない。
#
# 役割は 3 つだけ:
#   1. VAPID の設定を読む(未設定なら「機能ごと無効」として静かに落とす)
#   2. 購読先に送る(send_many = 並列・接続再利用・VAPID 鍵キャッシュ)
#   3. 送信結果で購読レコードの寿命を管理する(404/410 = 宛先が死んだ → 無効化)
#
# 2026-10 性能整理:
#   - 送信は I/O 待ちだけなのでスレッドで並列(1 つ遅い端末が全員を 10 秒ずつ待たせない)。
#     スレッド内では DB に触らない。結果を集めてから呼び元スレッドでまとめて書く。
#   - requests.Session を使い回す(プッシュサービスへの TLS 接続を毎回張らない)。
#   - VAPID 秘密鍵のパースは 1 回だけ(署名は宛先 origin ごとに毎回必要なので都度)。
#
# 文面の組み立てや「誰に送るか」はここには置かない(bgtasks/web_push_task.py の仕事)。

import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

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

# 1 回の送信の上限秒数と、同時に投げる本数。社内規模(数十端末)なら 8 で十分。
_TIMEOUT_SECONDS = 10
_MAX_PARALLEL = 8


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


_lock = threading.Lock()
_session = None
_vapid = None
_vapid_source = None


def _http_session():
    """プッシュサービス向けの共有 Session(接続プールで TLS を使い回す)。"""
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                import requests
                from requests.adapters import HTTPAdapter

                session = requests.Session()
                adapter = HTTPAdapter(pool_connections=4, pool_maxsize=_MAX_PARALLEL * 2)
                session.mount("https://", adapter)
                _session = session
    return _session


def _vapid_key():
    """パース済み VAPID 鍵。env が変わったら(コンテナ再作成で起きる)作り直す。"""
    global _vapid, _vapid_source
    raw = _vapid_private_key()
    if _vapid is None or _vapid_source != raw:
        with _lock:
            if _vapid is None or _vapid_source != raw:
                from py_vapid import Vapid

                _vapid = Vapid.from_string(private_key=raw)
                _vapid_source = raw
    return _vapid


@dataclass
class PushJob:
    subscription: object
    payload: dict
    # Topic: 同じ topic の未配達メッセージはプッシュサービス側で最新 1 通に置き換わる
    # (圏外から戻った端末に「状態変更」が 5 通積まれない)。None なら置き換えない。
    topic: str | None = None
    # Urgency: very-low / low / normal / high。省電力中の端末へ即時に届けるか。
    urgency: str = "normal"


@dataclass
class _Result:
    job: PushJob
    ok: bool
    dead: bool = False
    reason: str = ""


def _send_one(job: PushJob) -> _Result:
    """ネットワークだけ。DB には触らない(スレッドから呼ばれる)。"""
    from pywebpush import WebPushException, webpush

    sub = job.subscription
    headers = {"Urgency": job.urgency}
    if job.topic:
        headers["Topic"] = job.topic
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(job.payload, ensure_ascii=False),
            vapid_private_key=_vapid_key(),
            # 毎回新しい dict: pywebpush は claims に aud/exp を書き込む(宛先 origin ごとに違う)。
            vapid_claims={"sub": _vapid_subject()},
            ttl=_TTL_SECONDS,
            timeout=_TIMEOUT_SECONDS,
            headers=headers,
            requests_session=_http_session(),
        )
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        return _Result(job, ok=False, dead=status in _DEAD_STATUSES, reason=f"HTTP {status}" if status else str(exc))
    except Exception as exc:  # ネットワーク断・DNS 失敗など
        return _Result(job, ok=False, reason=repr(exc))
    return _Result(job, ok=True)


def send_many(jobs: list[PushJob]) -> int:
    """まとめて送る。送れた本数を返す。例外は投げない。

    プッシュはあくまで「おまけの経路」で、アプリ内通知(ベル)は別途必ず作られている。
    ここで落ちて通知作成そのものを巻き添えにしてはいけない。
    """
    if not jobs or not is_configured():
        return 0
    try:
        import pywebpush  # noqa: F401
    except ImportError:  # pragma: no cover - 依存が入っていない環境向けの保険
        logger.warning("pywebpush is not installed; web push disabled")
        return 0

    if len(jobs) == 1:
        results = [_send_one(jobs[0])]
    else:
        with ThreadPoolExecutor(max_workers=min(_MAX_PARALLEL, len(jobs))) as pool:
            results = list(pool.map(_send_one, jobs))

    _apply_results(results)
    return sum(1 for r in results if r.ok)


def send_to_subscription(subscription, payload: dict) -> bool:
    """購読 1 件に 1 通(互換用。新しいコードは send_many を使う)。"""
    return send_many([PushJob(subscription, payload)]) == 1


def _apply_results(results: list[_Result]) -> None:
    """送信結果を購読レコードへ。購読 1 件につき最大 1 回だけ書く。"""
    by_sub: dict = {}
    for r in results:
        by_sub.setdefault(r.job.subscription.id, []).append(r)

    now = timezone.now()
    for rows in by_sub.values():
        subscription = rows[0].job.subscription
        try:
            dead = next((r for r in rows if r.dead), None)
            if dead:
                # 宛先が消えた。ハードデリートではなく無効化に留めるのは、
                # 「いつどの端末が落ちたか」を後から追えるようにするため。
                _deactivate(subscription, reason=dead.reason)
            elif any(r.ok for r in rows):
                subscription.failure_count = 0
                subscription.last_used_at = now
                subscription.save(
                    update_fields=["failure_count", "last_used_at", "updated_at"],
                    disable_auto_set_user=True,
                )
            else:
                _count_failure(subscription, reason=rows[-1].reason)
        except Exception:
            logger.exception("web push result bookkeeping failed: %s", subscription.id)


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
