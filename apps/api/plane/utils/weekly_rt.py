# BARSOUL 週次ミーティング支援 — 実時配信の薄いラッパ (hechun 2026-07-24)
#
# 既存 realtime-sse を使う(新しいトランスポートは足さない)。宛先は
# **`/__rt/op`** — 本文不透明のまま全 SSE クライアントへ fan-out する口で、
# スキーマは client 側が決める(realtime-sse/main.go の設計意図そのもの)。
#   ✗ `/__rt/ingest` は「project 単位のカード失効」専用(evt.Project 必須)で、
#     週報の進捗やチャット発言には使えない — 形が違うと 400 で黙って落ちる。
# 揮発的・最善努力: 取りこぼしは画面の再読込で是正される(会議は止めない)。
import logging
import os
import time
from uuid import uuid4

import requests as _req

logger = logging.getLogger("plane.weekly")

_OP_URL = os.environ.get(
    "RT_OP_URL",
    os.environ.get("RT_INGEST_URL", "http://realtime-sse:7070/__rt/ingest").replace(
        "/__rt/ingest", "/__rt/op"
    ),
)


def push(meeting_id, event, data):
    """会議画面向けに 1 イベント。失敗しても呼出側は止めない。

    本文は前端 peer-sync の **PeerOp 形** に合わせる(`id` / `origin` / `t` / `ts`)。
    そうすると受信側は `peerSync.register("weekly", …)` を呼ぶだけで済み、
    realtime-sync.tsx にも SSE 層にも手を入れずに新 op を足せる
    (peer-sync の設計意図: 「新しい op の対応 = ハンドラ登録 1 箇所」)。
    origin は端末タブ ID と衝突しない固定値 — サーバ発は誰も自分発とみなさない。
    """
    try:
        r = _req.post(
            _OP_URL,
            json={
                "id": f"srv_{uuid4().hex}",
                "origin": "server",
                "t": "weekly",
                "ts": int(time.time() * 1000),
                "meeting_id": str(meeting_id),
                "event": event,
                "data": data,
            },
            timeout=3,
        )
        if r.status_code >= 300:
            logger.info(f"weekly rt push {event}: http {r.status_code}")
    except Exception as e:  # noqa: BLE001
        logger.info(f"weekly rt push failed ({event}): {e}")
