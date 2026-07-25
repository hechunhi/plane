# BARSOUL 週次ミーティング支援 (hechun 2026-07-21)
# docs/architecture/weekly-report-mvp.md v2。三層を厳密に分ける:
#
#   ① 不変・純読   issue_activities / issue_comments  ← **絶対に書き戻さない**
#   ② 派生(再生成可) WeeklyReportEntry.draft_html / ContentTranslation
#   ③ 新 SoR(人が書いた) WeeklyMeeting / WeeklyReportEntry.content_html /
#                        MeetingChatMessage  ← 消してはいけない
#
# ノートは自前 SoR を増やさず **Plane ネイティブ Page** に寄せる(WeeklyMeeting.page)。
import uuid

from django.conf import settings
from django.db import models

from .base import BaseModel


class WeeklyMeeting(BaseModel):
    """会期 — 「前回ミーティング確定時刻 → 今回」の窓。

    カレンダー週(月〜日)ではなく**会期**にするのは、金曜開催が翌週月曜へずれる
    運用例外があるため。固定窓だと金〜日の動作が欠落 or 二重計上する。
    `held_at` に印を付けた時刻が、次の会期の `period_start` になる。
    """

    STATUS_OPEN = "OPEN"          # 進行中(次回会議までの集計対象)
    STATUS_CONFIRMED = "CONFIRMED"  # 会議で確定済み → 次会期の起点になる

    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="weekly_meetings")
    title = models.CharField(max_length=255, blank=True, default="")
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    status = models.CharField(max_length=16, default=STATUS_OPEN)
    held_at = models.DateTimeField(blank=True, null=True)
    # ノート = Plane ネイティブ Page(会議 1 回につき 1 枚)。任意。
    page = models.ForeignKey(
        "db.Page", on_delete=models.SET_NULL, blank=True, null=True,
        related_name="weekly_meetings")

    class Meta:
        verbose_name = "Weekly Meeting"
        verbose_name_plural = "Weekly Meetings"
        db_table = "weekly_meetings"
        ordering = ("-period_end",)

    def __str__(self):
        return f"{self.workspace_id}:{self.period_start:%Y-%m-%d}~{self.period_end:%Y-%m-%d}"


class WeeklyReportEntry(BaseModel):
    """メンバー 1 人分の週報。

    `stats` / `sources` = ①活動流からの純読投影(再計算可)。
    `draft_html`        = ②litellm 生成の下書き(再生成可、捨ててよい)。
    `content_html`      = ③人が確定した版(**SoR**。空なら未編集 = draft を表示)。

    紅線(産品決定 2026-07-21):AI は評価語を生成しない。生成文には必ず
    `sources` の出処リンクが伴う。確定版は人の言葉。
    """

    # 下書き生成は非同期(1 人 ~70s、ローカル推論は直列)。画面が「生成中」を
    # 出せるよう状態を持つ。値は派生 — 失われても再生成すればよい。
    DRAFT_IDLE = ""
    DRAFT_QUEUED = "QUEUED"
    DRAFT_RUNNING = "RUNNING"
    DRAFT_DONE = "DONE"
    DRAFT_FAILED = "FAILED"

    meeting = models.ForeignKey(
        WeeklyMeeting, on_delete=models.CASCADE, related_name="entries")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="weekly_report_entries")
    # {"done": n, "progress": n, "discussion": n, "created": n}
    stats = models.JSONField(default=dict)
    # [{"bucket","issue_id","project_id","seq","title","kind","at","excerpt"}, ...]
    sources = models.JSONField(default=list)
    draft_html = models.TextField(blank=True, default="")
    content_html = models.TextField(blank=True, default="")
    model_used = models.CharField(max_length=64, blank=True, default="")
    draft_status = models.CharField(max_length=16, blank=True, default="")
    generated_at = models.DateTimeField(blank=True, null=True)
    edited_at = models.DateTimeField(blank=True, null=True)
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True,
        related_name="weekly_report_edits")

    class Meta:
        verbose_name = "Weekly Report Entry"
        verbose_name_plural = "Weekly Report Entries"
        db_table = "weekly_report_entries"
        ordering = ("member__display_name",)
        constraints = [
            models.UniqueConstraint(
                fields=["meeting", "member"], name="uniq_weekly_entry_per_member"),
        ]

    def __str__(self):
        return f"{self.meeting_id}:{self.member_id}"


class MeetingChatMessage(BaseModel):
    """会議中のリアルタイム翻訳チャット 1 発言(**SoR**)。

    スコープは会議画面に閉じる(産品決定 2026-07-21 論点 4):常時チャットには
    しない — chat.barsoul.jp / Hermes と役割が重複するため。
    発言者 = BaseModel.created_by。訳文は ContentTranslation に派生キャッシュ。
    """

    meeting = models.ForeignKey(
        WeeklyMeeting, on_delete=models.CASCADE, related_name="chat_messages")
    text = models.TextField()
    source_lang = models.CharField(max_length=8, blank=True, default="")
    # 打ち間違いを直せること = 会議チャットの最低限の易用性。編集時刻を残すのは
    # 「後から書き換えた」ことを隠さないため(訳文は編集のたび再生成する)。
    edited_at = models.DateTimeField(null=True, blank=True)
    # 引用返信。話が交錯する会議で「どの発言への返事か」を繋ぐ。親が取り消されても
    # 返信は残す(SET_NULL) — 文脈は薄れても返信自体は人の発言 SoR。
    reply_to = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies")
    # 画面キャプチャ 1 枚 = 会議で一番速い説明。Plane の資産パイプライン(FileAsset)に
    # 相乗りする — 保存先/署名 URL/容量制限を自前で作らない。1 発言 1 枚(複数貼りは
    # 発言を分ける): グループ表示の複雑さに見合う場面が会議には無い。
    attachment = models.ForeignKey(
        "db.FileAsset", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="meeting_chat_messages")

    class Meta:
        verbose_name = "Meeting Chat Message"
        verbose_name_plural = "Meeting Chat Messages"
        db_table = "meeting_chat_messages"
        ordering = ("created_at",)
        indexes = [models.Index(fields=["meeting", "created_at"])]

    def __str__(self):
        return f"{self.meeting_id}:{self.created_at:%H:%M:%S}"


class MeetingChatReaction(BaseModel):
    """発言への絵文字リアクション。

    双語チームでは「👍 / ✅」の一撃が一番速い相槌 — 文字を打つより、訳す手間もない。
    絵文字は **データ内容** なので UI アイコン(lucide)の縛りとは別枠。
    Plane 本家の CommentReaction と同じ (対象, actor, reaction) の三つ組。
    """

    message = models.ForeignKey(
        MeetingChatMessage, on_delete=models.CASCADE, related_name="reactions")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="meeting_chat_reactions")
    reaction = models.CharField(max_length=32)

    class Meta:
        verbose_name = "Meeting Chat Reaction"
        verbose_name_plural = "Meeting Chat Reactions"
        db_table = "meeting_chat_reactions"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["message", "actor", "reaction"],
                condition=models.Q(deleted_at__isnull=True),
                name="meeting_chat_reaction_unique_when_not_deleted",
            )
        ]

    def __str__(self):
        return f"{self.message_id}:{self.reaction}"


class ContentTranslation(BaseModel):
    """汎用 表示翻訳キャッシュ(issue 以外の実体用)。

    既存の IssueTranslation / CommentTranslation は実体ごとに表が分かれていた。
    週報エントリ・チャット発言・ノートという新実体が増えるため、
    (entity, object_id, field, target_lang) の汎用形へ一段抽象化した。
    **表示のみの派生。原文は一切変更しない**(source_hash で自己無効化)。
    """

    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="content_translations")
    # "weekly_entry" | "chat_message" | "page"
    entity = models.CharField(max_length=32)
    object_id = models.UUIDField(db_index=True)
    field = models.CharField(max_length=32, default="content")
    target_lang = models.CharField(max_length=8)      # "ja" | "zh" | "en"
    source_lang = models.CharField(max_length=8, blank=True, default="")
    text = models.TextField(blank=True, default="")
    translated_by = models.CharField(max_length=64, blank=True, default="aichan")
    source_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)

    class Meta:
        verbose_name = "Content Translation"
        verbose_name_plural = "Content Translations"
        db_table = "content_translations"
        constraints = [
            models.UniqueConstraint(
                fields=["entity", "object_id", "field", "target_lang"],
                name="uniq_content_translation"),
        ]
        indexes = [
            models.Index(fields=["entity", "object_id", "target_lang"]),
        ]

    def __str__(self):
        return f"{self.entity}:{self.object_id}:{self.field}:{self.target_lang}"
