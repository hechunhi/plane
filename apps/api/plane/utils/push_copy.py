# BARSOUL 2026-08 — プッシュ通知の文面。ここが唯一の文言置き場。
#
# 規則:
#   - 言語は受信者の Profile.language に従う(送信者ではない)。同じ出来事でも
#     日本語の人には日本語、中国語の人には中国語で届く。
#   - 対応外の言語は英語に落とす。日本語圏・中国語圏が実運用なので ja / zh-CN /
#     zh-TW / en の 4 つを手当てする。
#   - 技術用語は一切出さない。受け取るのは普通の社員。

from plane.utils.html_processor import strip_tags

# 本文に載せる引用の長さ。iOS のバナーは 2 行で切れるので、これ以上入れても
# 読まれずに「…」になるだけ。
_EXCERPT_LIMIT = 60

# アプリ名。iOS の通知はアプリ名がヘッダに出るが、Android / デスクトップでは
# タイトルがそのまま見出しになるのでここで名乗る。
APP_TITLE = "BARSOUL Tasks"

_FALLBACK = "en"

# 出来事ごとの本文テンプレート。
# {actor} = 相手の表示名 / {issue} = 作業項目名 / {excerpt} = 引用 / {value} = 新しい値
_TEMPLATES = {
    "mention": {
        "ja": "{actor}さんがあなたをメンションしました\n「{excerpt}」",
        "zh-CN": "{actor} 提到了你\n“{excerpt}”",
        "zh-TW": "{actor} 提到了你\n「{excerpt}」",
        "en": "{actor} mentioned you\n“{excerpt}”",
    },
    "comment_reply": {
        "ja": "{actor}さんがあなたのコメントに返信しました\n「{excerpt}」",
        "zh-CN": "{actor} 回复了你的评论\n“{excerpt}”",
        "zh-TW": "{actor} 回覆了你的留言\n「{excerpt}」",
        "en": "{actor} replied to your comment\n“{excerpt}”",
    },
    "comment": {
        "ja": "{actor}さんが「{issue}」にコメントしました\n「{excerpt}」",
        "zh-CN": "{actor} 在「{issue}」中留言\n“{excerpt}”",
        "zh-TW": "{actor} 在「{issue}」中留言\n「{excerpt}」",
        "en": "{actor} commented on “{issue}”\n“{excerpt}”",
    },
    "assigned": {
        "ja": "{actor}さんがあなたにタスクを割り当てました\n「{issue}」",
        "zh-CN": "{actor} 把任务指派给了你\n「{issue}」",
        "zh-TW": "{actor} 把任務指派給你\n「{issue}」",
        "en": "{actor} assigned a task to you\n“{issue}”",
    },
    "state_change": {
        "ja": "「{issue}」が {value} になりました",
        "zh-CN": "「{issue}」已变更为 {value}",
        "zh-TW": "「{issue}」已變更為 {value}",
        "en": "“{issue}” moved to {value}",
    },
    "priority_change": {
        "ja": "「{issue}」の優先度が {value} になりました",
        "zh-CN": "「{issue}」的优先级改为 {value}",
        "zh-TW": "「{issue}」的優先度改為 {value}",
        "en": "“{issue}” priority is now {value}",
    },
    "due_date_change": {
        "ja": "「{issue}」の期日が {value} になりました",
        "zh-CN": "「{issue}」的截止日期改为 {value}",
        "zh-TW": "「{issue}」的截止日期改為 {value}",
        "en": "“{issue}” is now due {value}",
    },
    # 期日リマインド。前日と当日で文面を変える(「明日」と「今日」は緊急度が違う)。
    "deadline_tomorrow": {
        "ja": "明日が期日です\n「{issue}」",
        "zh-CN": "明天到期\n「{issue}」",
        "zh-TW": "明天到期\n「{issue}」",
        "en": "Due tomorrow\n“{issue}”",
    },
    "deadline_today": {
        "ja": "今日が期日です\n「{issue}」",
        "zh-CN": "今天到期\n「{issue}」",
        "zh-TW": "今天到期\n「{issue}」",
        "en": "Due today\n“{issue}”",
    },
}

# 優先度は DB では英語の enum。通知に "urgent" と出しても伝わらないので訳す。
_PRIORITY = {
    "urgent": {"ja": "緊急", "zh-CN": "紧急", "zh-TW": "緊急", "en": "Urgent"},
    "high": {"ja": "高", "zh-CN": "高", "zh-TW": "高", "en": "High"},
    "medium": {"ja": "中", "zh-CN": "中", "zh-TW": "中", "en": "Medium"},
    "low": {"ja": "低", "zh-CN": "低", "zh-TW": "低", "en": "Low"},
    "none": {"ja": "なし", "zh-CN": "无", "zh-TW": "無", "en": "None"},
}


def normalize_language(language: str | None) -> str:
    """Profile.language を、文面テーブルが持っている言語に丸める。"""
    if not language:
        return _FALLBACK
    if language in ("ja", "zh-CN", "zh-TW", "en"):
        return language
    # "zh" 単体や "ja-JP" のような表記が入っても拾えるようにする。
    head = language.split("-")[0].lower()
    if head == "ja":
        return "ja"
    if head == "zh":
        return "zh-TW" if "TW" in language or "Hant" in language else "zh-CN"
    return _FALLBACK


def excerpt(html: str | None) -> str:
    """コメント本文(HTML)を通知に載せられる 1 行の素の文字にする。"""
    if not html:
        return ""
    text = " ".join(strip_tags(html).split())
    if len(text) > _EXCERPT_LIMIT:
        text = text[:_EXCERPT_LIMIT].rstrip() + "…"
    return text


def translate_priority(value: str | None, language: str) -> str:
    entry = _PRIORITY.get((value or "none").lower())
    if not entry:
        return value or ""
    return entry.get(language, entry[_FALLBACK])


def body_for(kind: str, language: str, **fields) -> str:
    """出来事の種類と言語から本文を作る。未知の種類なら空文字(= 送らない)。"""
    table = _TEMPLATES.get(kind)
    if not table:
        return ""
    template = table.get(language, table[_FALLBACK])
    safe = {"actor": "", "issue": "", "excerpt": "", "value": ""}
    safe.update({k: (v or "") for k, v in fields.items()})
    return template.format(**safe)
