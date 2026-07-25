# BARSOUL 週次ミーティング支援 — 下書き生成タスク (hechun 2026-07-24)
#
# なぜ非同期か: ローカル推論(MTPLX)は **要求を直列に処理する**。1 人分で実測
# ~70s、4 人で 3〜5 分 — HTTP 要求の中では絶対に終わらない。しかも同期で回すと
# 会議中の即時翻訳まで後ろに詰まる(実測: 巨大な週報生成の裏で翻訳が全滅した)。
# よって生成は worker に出し、進捗は既存 realtime-sse で画面へ返す。
#
# 直列で回すのは意図的 — 並列に投げても MLX 側で待たされるだけで、翻訳など
# 対話的な要求の待ち時間を伸ばすだけだから。
from celery import shared_task
from django.utils import timezone

from plane.db.models import WeeklyReportEntry
from plane.utils.weekly_llm import generate as llm_generate
from plane.utils.weekly_llm import lang_of as llm_lang_of
from plane.utils.weekly_rt import push as rt_push


def _entry_status_payload(entry):
    return {
        "entry_id": str(entry.id),
        "member_id": str(entry.member_id),
        "draft_status": entry.draft_status,
        "draft_html": entry.draft_html or "",
        "model_used": entry.model_used or "",
        "generated_at": entry.generated_at.isoformat() if entry.generated_at else None,
    }


@shared_task
def generate_weekly_drafts(meeting_id, entry_ids=None):
    """指定エントリの下書きを順に生成する。**content_html には一切触れない。**"""
    # member__profile まで引くのは生成言語(本人の UI 言語)を読む為 — 人数分の
    # 追加 query を出さない。
    qs = WeeklyReportEntry.objects.filter(
        meeting_id=meeting_id, deleted_at__isnull=True
    ).select_related("member", "member__profile")
    if entry_ids:
        qs = qs.filter(id__in=entry_ids)
    entries = list(qs.order_by("member__display_name"))

    for entry in entries:
        sources = entry.sources or []
        if not sources:
            entry.draft_status = WeeklyReportEntry.DRAFT_IDLE
            entry.save(update_fields=["draft_status", "updated_at"])
            continue

        entry.draft_status = WeeklyReportEntry.DRAFT_RUNNING
        entry.save(update_fields=["draft_status", "updated_at"])
        rt_push(meeting_id, "weekly_entry", _entry_status_payload(entry))

        member = entry.member
        name = (member.display_name or member.email) if member else ""
        # 起草は **本人の言語** で。課題が日本語でも中国語ユーザには中国語で
        # 書く — 本人が二次修正する物なので、慣れた言語でないと手が止まる。
        # Profile 未作成(招待直後等)は lang_of の既定へ落ちる。
        profile = getattr(member, "profile", None) if member else None
        lang = llm_lang_of(getattr(profile, "language", ""))
        html, model = llm_generate(entry.stats or {}, sources, name, lang=lang)

        if html:
            entry.draft_html = html
            entry.model_used = model
            entry.generated_at = timezone.now()
            entry.draft_status = WeeklyReportEntry.DRAFT_DONE
        else:
            # 失敗しても会議は止めない — 素の出処一覧は画面に出せる
            entry.draft_status = WeeklyReportEntry.DRAFT_FAILED
        entry.save(update_fields=[
            "draft_html", "model_used", "generated_at", "draft_status", "updated_at",
        ])
        rt_push(meeting_id, "weekly_entry", _entry_status_payload(entry))

    rt_push(meeting_id, "weekly_done", {"meeting_id": str(meeting_id)})
    return len(entries)
