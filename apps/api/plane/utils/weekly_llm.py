# BARSOUL 週次ミーティング支援 — 下書き生成層 (hechun 2026-07-21)
#
# 産品決定 2026-07-21(論点 1「AI 松綁」)の **3 条件** をここで担保する:
#   ① 出処必須   — LLM には ref 番号しか返させない。リンク生成はサーバ側の
#                  決定論的処理。LLM に URL を書かせない(捏造防止)。
#   ② 編集可能   — 生成物は下書き(draft_html)。確定版は人が書く(content_html)。
#   ③ 評価語なし — プロンプトで禁止し、生成後に禁止語スキャンで二重に落とす。
# 決定 1「ランキングなし・採点なし」は据え置き — 比較・順位・優劣を出さない。
import html as _html
import json
import logging
import os
import re

import requests as _req

from plane.utils import cjk_glyph as _glyph

logger = logging.getLogger("plane.weekly")

# 要約は文脈保持が要る → 専用 MT(hy-mt2)ではなく主脳グループを使う。
# litellm 側の別名。既定 "default"(= qwen3.6-35b-a3b)。
WEEKLY_MODEL = os.environ.get("LLM_WEEKLY_MODEL", "default").strip()
# 下書きの生成言語。もう一方の言語は既存の翻訳モジュール経由で表示時に得る。
WEEKLY_LANG = os.environ.get("LLM_WEEKLY_LANG", "ja").strip()
# worker で回すので長めに取る(実測 12 出処 ≈ 69s、上限一杯で 3 分前後)。
_TIMEOUT = int(os.environ.get("LLM_WEEKLY_TIMEOUT", "300"))
# LLM に渡す事実の上限。ローカル dense 27B の prefill は ~113 tok/s なので、
# 事実を無制限に渡すと首トークンだけで数分かかる(M4 Pro の構造的な上限で、
# モデルを替えても治らない)。**出処一覧は全件そのまま画面に出る** — ここで
# 絞るのは要約の入力だけ。ref 番号は元の sources の添字を保つ。
_MAX_FACTS = int(os.environ.get("LLM_WEEKLY_MAX_FACTS", "45"))
# 評論の抜粋長。長文評論 1 件で prefill を食い潰さないため。
_EXCERPT = int(os.environ.get("LLM_WEEKLY_EXCERPT", "120"))

_BUCKET_TITLE = {
    "ja": {"done": "完了した事", "progress": "進行中の事", "discussion": "議論への貢献"},
    "zh": {"done": "完成的事", "progress": "推进中的事", "discussion": "讨论贡献"},
}

# 評価語ブラックリスト(条件③の後段チェック)。事実の要約以外が混ざったら落とす。
_BANNED = re.compile(
    r"(素晴らし|見事|優秀|頑張っ|よく出来|さすが|遅れ気味|停滞して|物足りな|不十分|"
    r"很努力|表现优秀|表现不佳|值得表扬|落后|拖延|不够|做得好|积极性|态度)",
)

_SYS = {
    "ja": (
        "あなたは越境EC企業 BARSOUL の議事アシスタント。与えられた**事実リスト**を、"
        "週次ミーティング用に読みやすく整理するのが仕事です。\n"
        "**絶対禁止**:\n"
        "- 評価・称賛・叱責・優劣・順位・点数・情緒的表現を書かないこと\n"
        "- 事実リストに無い情報を足さないこと(推測・補完の禁止)\n"
        "- URL やリンクを自分で書かないこと(ref 番号だけ使う)\n"
        "- **対象メンバーの名前を text に書かないこと** — 節ごとに人は決まっている。"
        "「〜した」と主語なしで書く\n"
        "**やること**: 同じ話題をまとめ、事実を簡潔な一文にし、根拠になった項目の "
        "ref 番号を必ず添える。評論は要約せず要点のみ触れる。\n"
        "**text は日本語だけで書くこと** — 中国語の語彙を混ぜない"
        "(事実リストが中国語でも日本語に直す)。固有名詞・製品名はそのままでよい。\n"
        "出力は JSON のみ。"
    ),
    "zh": (
        "你是 BARSOUL 的会议助理。你的工作是把给定的**事实清单**整理成便于周会阅读的形式。\n"
        "**绝对禁止**:\n"
        "- 写任何评价、表扬、批评、优劣、排名、打分或情绪化表达\n"
        "- 添加事实清单之外的信息(禁止推测和脑补)\n"
        "- 自己编写 URL 或链接(只使用 ref 编号)\n"
        "- **不要在 text 里写对象成员的名字** — 每一节的人是固定的,直接省略主语\n"
        "**要做的**: 合并同一话题,把事实写成简洁的一句话,并必须附上依据项的 ref 编号。"
        "评论不做转述,只点出要点。\n"
        "**text 只用中文书写** — 不要混入日文词汇(事实清单是日文也要转成中文)。"
        "专有名词、产品名可保留原文。\n"
        "只输出 JSON。"
    ),
}

_SCHEMA_HINT = (
    '{"done":[{"text":"…","refs":[1,2]}],'
    '"progress":[{"text":"…","refs":[3]}],'
    '"discussion":[{"text":"…","refs":[4]}]}'
)


def _pick(sources, cap=None):
    """要約に渡す事実を選ぶ。戻り値は **元の添字** 付き [(idx, src), ...]。

    上限を超える週は、バケットを回り持ちしながら新しい順に取る — 単純に頭から
    切ると「完了」だけが落ちる、といった偏りが出るため。添字を持ち回るのは
    ref 番号が全 sources に対する位置を指し続ける必要があるから(条件①)。
    """
    cap = _MAX_FACTS if cap is None else cap
    idxed = list(enumerate(sources))
    if len(idxed) <= cap:
        return idxed

    by_bucket = {"done": [], "progress": [], "discussion": []}
    for i, s in idxed:
        by_bucket.setdefault(s.get("bucket") or "progress", []).append((i, s))
    for v in by_bucket.values():
        v.sort(key=lambda t: t[1].get("at") or "", reverse=True)

    picked, order = [], ("done", "progress", "discussion")
    while len(picked) < cap and any(by_bucket.get(b) for b in order):
        for b in order:
            lst = by_bucket.get(b)
            if lst:
                picked.append(lst.pop(0))
                if len(picked) >= cap:
                    break
    picked.sort(key=lambda t: t[0])
    return picked


def _name_pat(name):
    """本人の名前 + **1 文字だけ違う誤字** に当たるパターン。

    量子化モデルは人名の字を滑らせる(「何淳」→「何純」)。名前は事実そのもの
    なので画面に誤字を出すわけにいかない。姓の 1 文字目は完全一致を要求する —
    そうしないと別の同僚の名前まで消してしまう。
    """
    # ワイルドカードから「さ」「氏」を外す — 外さないと「何さん」の「さ」を
    # 誤字扱いで食ってしまい、「んが…」が残る。
    w = r"[^\sさ氏、。]"
    full = [re.escape(name)]
    for i in range(1, len(name)):
        full.append(re.escape(name[:i]) + w + re.escape(name[i + 1:]))
    # 姓だけ + さん(「何さんが」)。姓の切れ目は分からないので前方一致すべてを
    # 候補にするが、**さん/氏 が続く時だけ** 認める(1 文字だけ消さないため)。
    pre = [re.escape(name[:i]) for i in range(1, len(name))]
    return "(?:(?:{f})(?:さん|氏)?|(?:{p})(?:さん|氏))".format(
        f="|".join(full), p="|".join(pre) or re.escape(name)
    )


def _strip_self_name(text, member_name):
    """節ごとに人は決まっているので、文頭の自己言及は落とす(誤字ごと消える)。"""
    if not text or not member_name or len(member_name) < 2:
        return text
    # 名前の直後が目的格の助詞なら **主語ではない**(「何さんに対する求人内容…」)。
    # ここで消すと文が頭から欠ける — 落とすのは主語としての自己言及だけ。
    out = re.sub(
        r"^" + _name_pat(member_name) + r"(?![にをへとかでより])(?:が|は|も|の)?[\s、]*",
        "",
        text,
        count=1,
    )
    return out or text


def _facts(sources, lang):
    """出処リストを LLM 入力用の番号付き事実行にする。ref 番号 = 1 始まり。"""
    lines = []
    for i, s in _pick(sources):
        key = f"{s.get('identifier','')}-{s.get('sequence_id','')}"
        kind = s.get("kind", "")
        at = (s.get("at") or "")[:10]
        base = f"[{i + 1}] {at} {key} 「{s.get('title','')}」 / {kind}"
        if s.get("excerpt"):
            base += f" / 原文: {s['excerpt'][:_EXCERPT]}"
        lines.append(base)
    return "\n".join(lines)


def _call(payload):
    url = os.environ.get("LLM_GATEWAY_URL", "").strip()
    if not url:
        logger.warning("weekly_llm: LLM_GATEWAY_URL unset")
        return ""
    try:
        r = _req.post(url, json=payload, timeout=_TIMEOUT)
        r.raise_for_status()
        return (r.json()["choices"][0]["message"]["content"] or "").strip()
    except Exception as e:  # noqa: BLE001 — 失敗は下書き無しで返す(会議は止めない)
        logger.warning(f"weekly_llm: call failed: {e}")
        return ""


def _parse(raw):
    """```json フェンス等を剥がして dict にする。壊れていたら None。"""
    if not raw:
        return None
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None
    return d if isinstance(d, dict) else None


def generate(stats, sources, member_name, lang=None):
    """下書きを生成して (html, model_used) を返す。失敗時は ("", "")。

    LLM が落ちても会議は止めない — 呼出側は sources だけで素の一覧を出せる。
    """
    lang = (lang or WEEKLY_LANG) if (lang or WEEKLY_LANG) in _SYS else "ja"
    if not sources:
        return "", ""

    user = (
        f"対象メンバー: {member_name}\n"
        f"件数: 完了 {stats.get('done',0)} / 進行中 {stats.get('progress',0)} / "
        f"議論 {stats.get('discussion',0)}\n\n"
        f"事実リスト:\n{_facts(sources, lang)}\n\n"
        f"次の形の JSON だけを出力: {_SCHEMA_HINT}"
    ) if lang == "ja" else (
        f"对象成员: {member_name}\n"
        f"条数: 完成 {stats.get('done',0)} / 推进中 {stats.get('progress',0)} / "
        f"讨论 {stats.get('discussion',0)}\n\n"
        f"事实清单:\n{_facts(sources, lang)}\n\n"
        f"只输出如下形式的 JSON: {_SCHEMA_HINT}"
    )

    raw = _call({
        "model": WEEKLY_MODEL,
        "messages": [
            {"role": "system", "content": _SYS[lang]},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 1600,
    })
    data = _parse(raw)
    if not data:
        return "", ""
    return render(data, sources, lang, member_name=member_name), WEEKLY_MODEL


def render(data, sources, lang="ja", member_name=""):
    """LLM の JSON → 出処リンク付き HTML。**リンクはここでしか作らない**。

    ref はアンカーではなく data-* を持つ span で出す — 実際の URL は
    フロントが PLANE_PUBLIC とワークスペース slug から組み立てる(バックエンドに
    公開ホストを焼き付けない)。
    """
    titles = _BUCKET_TITLE.get(lang, _BUCKET_TITLE["ja"])
    parts = []
    for bucket in ("done", "progress", "discussion"):
        items = data.get(bucket) or []
        if not isinstance(items, list) or not items:
            continue
        lis = []
        for it in items:
            if not isinstance(it, dict):
                continue
            text = (it.get("text") or "").strip()
            text = _strip_self_name(text, member_name).strip()
            if lang == "ja" and text:
                # 2bit 量子化モデルは字形だけ簡体に滑ることがある(「30日期间」)。
                # 語は正しいので再生成せず字形だけ直す。直しきれない = 文ごと
                # 中国語 → 記録に残す(黙って通すが、観測できるようにする)。
                text = _glyph.to_ja(text)
                if _glyph.has_chinese_residue(text):
                    logger.info(f"weekly_llm: chinese residue in ja draft: {text[:60]}")
            if not text or _BANNED.search(text):
                # 条件③: 評価語が混ざった行は丸ごと落とす(黙って通さない)
                if text:
                    logger.info(f"weekly_llm: dropped evaluative line: {text[:60]}")
                continue
            refs, seen_issue = [], set()
            for n in (it.get("refs") or []):
                try:
                    s = sources[int(n) - 1]
                except (ValueError, TypeError, IndexError):
                    continue
                # 同じカードは 1 回だけ出す — 1 枚に複数の活動が紐づくと
                # LLM が別々の ref を返し、[IUTEYA-24]×3 のように並ぶため。
                iid = str(s.get("issue_id", ""))
                if iid in seen_issue:
                    continue
                seen_issue.add(iid)
                refs.append(
                    '<span class="wr-ref" data-project-id="{p}" data-issue-id="{i}">{k}</span>'.format(
                        p=_html.escape(str(s.get("project_id", ""))),
                        i=_html.escape(str(s.get("issue_id", ""))),
                        k=_html.escape(f"{s.get('identifier','')}-{s.get('sequence_id','')}"),
                    )
                )
            if not refs:
                # 条件①: 出処の無い生成文は出さない
                logger.info(f"weekly_llm: dropped unsourced line: {text[:60]}")
                continue
            lis.append(f"<li>{_html.escape(text)} {' '.join(refs)}</li>")
        if lis:
            parts.append(f"<h4>{_html.escape(titles[bucket])}</h4><ul>{''.join(lis)}</ul>")
    return "".join(parts)
