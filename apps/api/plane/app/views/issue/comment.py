# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import Exists
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueCommentSerializer, CommentReactionSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueComment, ProjectMember, CommentReaction, Project, Issue, CommentTranslation
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host
from plane.bgtasks.webhook_task import model_activity, webhook_activity
# BARSOUL: lazy translate (X-style 即点即译)
import os
import re
import hashlib as _hashlib
import logging
import requests as _req
from .. import BaseAPIView

logger = logging.getLogger(__name__)


class IssueCommentViewSet(BaseViewSet):
    serializer_class = IssueCommentSerializer
    model = IssueComment
    webhook_event = "issue_comment"

    filterset_fields = ["issue__id", "workspace__id"]

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("issue")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"),
                        project_id=self.kwargs.get("project_id"),
                        member_id=self.request.user.id,
                        is_active=True,
                    )
                )
            )
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, issue_id):
        project = Project.objects.get(pk=project_id)
        issue = Issue.objects.get(pk=issue_id)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to comment on the issue"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = IssueCommentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id, actor=request.user)
            issue_activity.delay(
                type="comment.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(serializer.data["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def partial_update(self, request, slug, project_id, issue_id, pk):
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        serializer = IssueCommentSerializer(issue_comment, data=request.data, partial=True)
        if serializer.is_valid():
            if "comment_html" in request.data and request.data["comment_html"] != issue_comment.comment_html:
                serializer.save(edited_at=timezone.now())
            else:
                serializer.save()
            issue_activity.delay(
                type="comment.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(pk),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def destroy(self, request, slug, project_id, issue_id, pk):
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        issue_comment.delete()
        issue_activity.delay(
            type="comment.activity.deleted",
            requested_data=json.dumps({"comment_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        # BARSOUL realtime: Plane CE のコメント destroy は webhook 未発火
        #   (create/partial_update は model_activity 発火) → 他窓口で
        #   削除コメントが消えない。create/update と同じ issue_comment
        #   webhook に乗せる。deleted は対象が消えるので親 issue を明示
        #   付与 → ai-bot _ct_pub が data["issue"] で対象特定 → 開いてる
        #   パネルのみ comment store を全再取得(削除/編集も反映)。
        webhook_activity.delay(
            event="issue_comment",
            verb="deleted",
            field=None,
            old_value=None,
            new_value=None,
            actor_id=str(request.user.id),
            slug=slug,
            current_site=base_host(request=request, is_app=True),
            event_id=str(pk),
            old_identifier=None,
            new_identifier=None,
            project_id=str(project_id),
            parent_issue_id=str(issue_id),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# BARSOUL: X-style 即点即译 — cookie auth, project member, lazy LLM gateway.
# 缓存命中 → 即刻返;缓存未命中 → 调 LLM 网关 → upsert 派生表 → 返。
# ai-bot autotranslate 仍在后台预热缓存(写入時),大多数点击会命中。
_HTML_STRIP = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_HK_RE = re.compile(r"[぀-ゟ゠-ヿ]")  # ひらがな/カタカナ (findall 用)
_HAN_RE = re.compile(r"[一-鿿]")
# BARSOUL 2026-05-27 (hechun): 段落構造保持. Plane の comment_html は
# <p>...</p><p>...</p> や <br> で論理段落を分けるが、旧 _strip は
# 全空白を単スペース 1 個に潰すため、LLM 入力時点で段落破壊が確定し
# 「段落塌陷」no-op 検出も発火し得ない (\n\n が source に無いため).
# → <br>/<p>/<div>/</p>/</div> を一旦 \n に置換してから tag strip.
_BLOCK_RE = re.compile(
    r"</?(p|div|h[1-6]|li|tr|blockquote|article|section)\b[^>]*>|<br\s*/?>",
    re.IGNORECASE,
)
# 段内連空白(タブ/全角空白等)は 1 個に潰すが、改行は跨がない
_INLINE_WS = re.compile(r"[ \t　\xa0]+")
# 3 連以上の改行は 2 連まで(段落区切り 1 個分)
_NL_MAX = re.compile(r"\n{3,}")


def _strip(h):
    """HTML → 段落構造保持つきプレーンテキスト.

    旧:  <p>A</p><p>B</p>  →  "A B"   (paragraphs lost)
    新:  <p>A</p><p>B</p>  →  "A\n\nB" (paragraphs survive → LLM 段落保持発動)
    """
    if not h:
        return ""
    # 1) <br> / block tags → \n
    s = _BLOCK_RE.sub("\n", h)
    # 2) 残る tag を空に
    s = _HTML_STRIP.sub("", s)
    # 3) 行内連空白を 1 個に圧縮(改行は保持)
    lines = [_INLINE_WS.sub(" ", ln).strip() for ln in s.split("\n")]
    s = "\n".join(lines)
    # 4) 3+連改行 → 2 連改行(段落区切り)
    s = _NL_MAX.sub("\n\n", s)
    return s.strip()


def _detect_src(text):
    """Return source lang code or None (比率ベース、2026-05-27 修正).

    旧: 任意 1 文字でも假名なら ja 判定 → 中文 95% + 日文人名 5% でも
    ja 誤判 → ja→zh 翻訳要求 → LLM 中文 rephrasing でゴミ翻訳が出る
    (実例 BS-127「李美京小姐...そうさん的公司」). frontend display.tsx
    と同じ閾値 (kana / (kana+han) ≥ 0.2 → ja) で対称防御.
    """
    if not text:
        return None
    kana = len(_HK_RE.findall(text))
    han = len(_HAN_RE.findall(text))
    total = kana + han
    if total == 0:
        return None
    if kana / total >= 0.2:
        return "ja"
    if han > 0:
        return "zh"
    return None


def _looks_like_noop(text, out, tgt):
    """检测模型是否在 punt(复述原文 或 没翻译到目标语 或 段落塌陷)。

    no-op 判定:
      1. 空输出
      2. 输出 normalize 后 == 输入 normalize 后(只 strip 空白/全半角)
      3. tgt=ja 但输出无任何假名(全汉字 + 数字 + 英文 → 没真翻成日文)
      4. tgt=zh 但输出含假名(没翻译干净,还残留日文)
      5. (2026-05-27) 段落塌陷:源含多段(\\n\\n × 2+)但输出无 \\n
         → 模型把多段邮件 / 多行表单压扁成一句,阅读体验差,算失败 → 升级。

    回 True = no-op 失败,caller 应 fallback / 报错。"""
    if not out:
        return True
    norm = lambda s: (s or "").replace(" ", "").replace("　", "") \
        .replace("，", ",").replace("、", ",").replace("。", ".").strip()
    if norm(out) == norm(text):
        return True
    import re as _re
    # BARSOUL 2026-06-02 (hechun): 片假名中点「・」(U+30FB) は分隔符であって
    # 「未翻訳の日本語」ではない(商品名【B-4・金】や箇条書「・10時〜」で正当に
    # 保持される)。旧 regex [゠-ヿ] が ・ を kana 扱い → ja→zh の良訳を no-op 誤判
    # → 502 "translation failed" を量産(・ を含む業務コメントが全滅)。U+30FB を除外。
    has_kana = bool(_re.search(r"[぀-ゟ゠-ヺー-ヿ]", out))
    if tgt == "ja" and not has_kana:
        return True
    # BARSOUL 2026-06-05 (hechun, BS-226): tgt=zh で「假名が1つでもあれば no-op」は
    # 誤判が酷い。中訳でも商品名/ブランド名(モノタロウ, Shaken等のカナ表記)や
    # 単位は原文保持が正当 → 少量のカナは正常。旧ロジックは「モノタロウー商品」を
    # 含む完璧な中訳を全部 no-op 判定 → fallback 全滅 → 翻訳失敗/半截 cache 事故
    # (BS-226 の真因)。カナ「比率」で判定: 訳文の 15% 超がカナ = 訳し残し、と緩和。
    if tgt == "zh" and has_kana:
        kana_n = len(_re.findall(r"[぀-ゟ゠-ヺー-ヿ]", out))
        if kana_n > max(8, len(out.strip()) * 0.15):
            return True
    # 段落塌陷:源至少 2 个空行(\n\n+)而输出 0 个 \n → 小模型把段落压扁
    if (text or "").count("\n\n") >= 2 and out.count("\n") == 0:
        return True
    # BARSOUL 2026-06-05 (hechun, BS-226): 截断検出。hy-mt2 が途中 EOS で半截
    # (例: 120字原文→14字「综合各个issue来看,似乎」だけ訳して停止)を出すと、
    # 旧 no-op 判定を全てすり抜けて DB cache に保存 → 以後ずっと半截を返す事故。
    # 原文が十分長い(>50字)のに訳文が原文の 35% 未満 = 途中切れと判定し no-op 扱い
    # → fallback/再試行へ。中日は多少縮むが 35% 下回るのは正常翻訳ではあり得ない
    # (実測: 同入力の完全訳は原文比 ~85%)。短文(<50字)は対象外(短訳は正当)。
    src_len = len((text or "").strip())
    out_len = len((out or "").strip())
    if src_len > 50 and out_len < src_len * 0.35:
        return True
    return False


# BARSOUL 2026-05-24:fallback chain。
# 2026-05-27 (月極駐車場 邮件事故修):**gemma-4-26b 优先于 default(qwen3.5-4b)**
# 因为 qwen 在长文 + 多段输入下**不保留 \n 段落结构**(实测 30 段日文邮件
# → qwen 输出 0 个 \n,压扁单段)。gemma 30 个 \n 完美保段。链路改:
# hy-mt2(快、505ms)→ gemma-4-26b(段落保留、~5s)→ default(最后兜底)。
# BARSOUL 2026-05-28: gemma-4-26b @ :8001 サービス未起動 → ゲートウェイで
# 死路由 → 502。残る 2 段(hy-mt2 + default=qwen3.5-4b alias)で実運用十分。
# 段落保持の劣化は qwen3.5-4b で十分(月極駐車場ケースの様な長文邮件は
# 稀;実害顕在化したら ROUTES env で gemma 復活 + chain 再追加).
# BARSOUL 2026-05-31 (hechun): default(=qwen3.5-4b alias) は汎用 4B で翻訳品質
# 低い(主语颠倒/用語ブレ/system 不追従)→ 翻訳 chain から下線。翻訳専用
# hy-mt2 のみ残す。cloud Claude → hy-mt2 → 502 のクリーン 2 段。
_TRANSLATE_FALLBACK_CHAIN = ["hy-mt2"]


def _try_one_model(url, model, sys_msg, text, tgt="zh", context=""):
    """单次模型调用 + preamble strip。失败/异常返 ""。

    BARSOUL 2026-05-30 (hechun + Hy-MT2 官方 doc): hy-mt2 是翻译专用模型,
    官方明确「无 default system_prompt」+ 靠 user message 的 native template +
    推荐采样(temp0.7/top_p0.6/top_k20/rep1.05)。实测原生用法把段落塌陷/截断/
    no-op 一扫(761字8段 zh→ja 段落8/8 完美)。故 hy-mt2 走原生路, 其它模型
    (default=qwen3.5-4b)仍用 system prompt + temp0.2(qwen 跟随 system)。

    context (BS-150 後の追加, 2026-05-30): issue 件名等の dialog 文脈を
    natural-sentence prefix で注入 → 1.8B hy-mt2 が省略主语を「会話の第三者」
    と推断できる(c1「日本人ですがモデルしてた方が…」← 主语颠倒問題 修)。
    実測: 件名一行で c1 fix, no marker leak, 副作用ゼロ。
    """
    try:
        if model == "hy-mt2":
            tgt_name = "中文（简体）" if tgt == "zh" else "日语"
            # 自然文 prefix: hy-mt2 は marker(【...】, ---, <tag>) を翻訳出力に
            # 漏らす事があるが、natural-sentence 形なら漏れず文脈だけ受け取る。
            ctx_prefix = ""
            if context and context.strip():
                ctx_prefix = f"以下是「{context.strip()[:80]}」工单的对话片段。"
            # BARSOUL 2026-05-31 (hechun, 7B 能力诊断後): 视点/态规则。Hy-MT2-7B
            # の唯一の残課題は「主语省略+态変化」での施動者判定 (診断 26 case 中
            # A1/A3/G1 のみ FAIL)。正例 only の規則 4 条で 3/3 修復・0 回帰・
            # leak 無し・複数の副次改善を実測。规则は**日译中(源=日语)のみ** —
            # 中译日は日语の省略歧义が無いので付けない(無駄+混乱回避)。
            voice_rule = ""
            if tgt == "zh":
                voice_rule = (
                    "翻译时注意日语的“谁对谁做”关系：\n"
                    "・省略主语时按敬语和上下文判断施动者（常是对话中提到的第三者，不是说话人）；\n"
                    "・「〜ように言われた／〜とのこと」是转述他人的指示，执行者是被指示的一方；\n"
                    "・「Xに〜られる／言われる」是被动，主语是承受方，保留“被”的语气；\n"
                    "・定语从句（〜してた方／〜した人）要完整译出，不要压缩合并。\n")
            # 官方 Hy-MT2-Translator skill 整合: basic mode(指示最小)が反流ゼロ +
            # 段落自然保持(761字8段で para 8/8)。temp 0.1 + 余分な sampling 無し。
            usr = (f"{voice_rule}{ctx_prefix}将以下文本翻译为{tgt_name}，"
                   f"注意只需要输出翻译后的结果，不要额外解释：\n\n{text[:1800]}")
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": usr}],
                "temperature": 0.1, "max_tokens": 4096,
            }
        else:
            # 非 hy-mt2: 自然文 prefix。marker 形(【参考】)は qwen が訳出に
            # 漏らす実証あり → 自然な sentence にして漏れ防止。
            user_msg = text[:1500]
            if context and context.strip():
                user_msg = (f"以下は「{context.strip()[:80]}」工单の対話片段。"
                            f"訳文のみ出力:\n{user_msg}")
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.2, "max_tokens": 1500,
            }
        r = _req.post(url, json=payload, timeout=60)
        if r.status_code != 200:
            return ""
        j = r.json()
        msg = ((j.get("choices") or [{}])[0] or {}).get("message", {}) or {}
        out = (msg.get("content") or "").strip()
        # 前置きラベル除去。hy-mt2 native は 【...】見出しを正当に訳出するので
        # 【 strip は非 hy-mt2 のみ(误删正文标题防止)。
        prefixes = ("訳:", "翻訳:", "译文:", "译文：", "中文:", "日本語:")
        if model != "hy-mt2":
            prefixes = ("【",) + prefixes
        for p in prefixes:
            if out.startswith(p) and "\n" in out:
                out = out.split("\n", 1)[1].strip()
        return out
    except Exception:
        return ""


def _call_llm(text, src, tgt, context=""):
    """Call LLM gateway with translation prompt + no-op detection + fallback chain.
    Returns translated str (translated_by 由 caller 通过 _last_model_used 拿)。

    context (2026-05-30): issue 件名等の dialog 文脈。hy-mt2 が省略主语を
    第三者に推断するために必要(BS-150 c1 修)。"""
    url = os.environ.get("LLM_GATEWAY_URL", "").strip()
    if not url:
        return ""
    src_label = "日本語" if src == "ja" else ("中文" if src == "zh" else src)
    tgt_label = "中文（簡体字）" if tgt == "zh" else ("日本語" if tgt == "ja" else tgt)
    # BARSOUL 2026-05-24:hy-mt2 (Hy-MT2-1.8B-mlx-q4) 在专有名词 + 数字 + 英文密度高的输入上
    # 会直接 punt 复述原文(no-op 失败)。实测加强制指令 + 显式保持规则后稳定性 50% → 100%
    # (P1 prompt 三轮 6/6 case 全通过)。即便如此再加 fallback chain 兜底。
    sys = (
        f"あなたは越境EC企業 BARSOUL(大阪・日中チーム)の業務翻訳者。"
        f"**必須**: 入力された{src_label}を{tgt_label}に翻訳して出力する。"
        "原文をそのまま返してはならない。原文と異なる訳文を必ず出力する。\n"
        "**段落フォーマット (2026-05-27 hechun):** 原文の段落区切り(空行 \\n\\n)を\n"
        "**訳文でも同じ位置に空行を入れて保つ**。論理段落ごとに空行で分けて読みやすく。\n"
        "リスト(1./2./・/- 等)は原文の改行構造を維持。\n\n"
        "規則:\n"
        f"- 出力は{tgt_label}の翻訳文のみ(前置き・引用符・原文併記なし)\n"
        "- 人名 / 電話番号 / 住所固有名 / 英語ブランド名(例 Shaken Not Stirred) / 数値 / 日付 / 金額 は保持\n"
        "- 内容が短くても必ず翻訳する。コピーは禁止。"
    )
    for model in _TRANSLATE_FALLBACK_CHAIN:
        out = _try_one_model(url, model, sys, text, tgt, context=context)
        if out and not _looks_like_noop(text, out, tgt):
            # 把实际成功的 model 记到 module attr,view 后续读出来写 translated_by
            globals()["_last_model_used"] = model
            return out
        logger.info(f"_call_llm: model={model} no-op or empty, trying next")
    globals()["_last_model_used"] = ""
    return ""


# ── BARSOUL 2026-05-29: クラウド Claude 翻訳(ai-bot 経由)を主路に ──────────
# plane-api は Docker 内 → 宿主の claude CLI に直接届かない。宿主の ai-bot
# (/translate) が cloud_translate を代行する。失敗(ai-bot 不通/token切れ)時のみ
# 下の _call_llm 本地 chain へ退避。LLM_GATEWAY_URL と同型で host.docker.internal。
#
# ── BARSOUL 2026-05-31 (hechun): DEPRECATED ──────────────────────────────────
# Claude CLI(subprocess) は OAuth/subscribe で 30s+ 静默 hang する不安定さあり,
# 4b 退避も翻訳品質低くて両方下線 → 翻訳は hy-mt2 一本路に簡素化(専用 1.8B MT
# で十分, +ctx で主语推断問題も解決済 BS-150)。
# 以下の `_cloud_translate` / `_AIBOT_TRANSLATE_URL` は **呼び出し無し**, 将来
# Anthropic API 直叩き等で復活する余地として残置(削除しない)。
_AIBOT_TRANSLATE_URL = os.environ.get(
    "AIBOT_TRANSLATE_URL", "http://host.docker.internal:8098/translate"
).strip()


def _cloud_translate(text, src, tgt, context=""):
    """ai-bot /translate(クラウド Claude)を呼ぶ。成功=訳文, 失敗="".
    context (2026-05-30): issue 件名等の dialog 文脈 → cloud_translate(ctx=)
    へ透传 → Claude が用語統一/主語推断の参考にする。"""
    if not _AIBOT_TRANSLATE_URL:
        return ""
    try:
        body = {"text": text[:4000], "source": src, "target": tgt}
        if context and context.strip():
            body["ctx"] = context.strip()[:300]
        r = _req.post(
            _AIBOT_TRANSLATE_URL,
            json=body,
            timeout=45,
        )
        if r.status_code != 200:
            return ""
        j = r.json()
        if j.get("ok") and j.get("by", "").startswith("cloud"):
            globals()["_last_model_used"] = j.get("by", "cloud:claude")
            return (j.get("text") or "").strip()
    except Exception as e:
        logger.info(f"_cloud_translate failed: {type(e).__name__}: {e}")
    return ""


class CommentTranslateOnDemandEndpoint(BaseAPIView):
    """POST /api/workspaces/{slug}/projects/{pid}/issues/{iid}/comments/{cid}/translate/
    Body: {target_lang: "zh"|"ja"}
    Cookie auth (Plane session)。缓存命中即返,未命中 LLM + upsert。
    继承 BaseAPIView → 自带 session auth + IsAuthenticated;
    @allow_permission([ADMIN,MEMBER,GUEST]) = 项目成员都可触发翻译。"""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id, comment_id):
        try:
            comment = IssueComment.objects.get(
                pk=comment_id, workspace__slug=slug,
                project_id=project_id, issue_id=issue_id,
            )
        except IssueComment.DoesNotExist:
            return Response({"error": "comment not found"}, status=status.HTTP_404_NOT_FOUND)

        target_lang = (request.data or {}).get("target_lang", "").strip().lower()[:8]
        if not target_lang:
            return Response({"error": "target_lang required"}, status=status.HTTP_400_BAD_REQUEST)

        # BARSOUL 2026-05-30: rich 翻訳 — frontend が画像/@mention を ⟦N⟧ 占位符に
        # 置換した tokenized text を `text` で渡す。comment_html を strip せず、
        # masked text をそのまま翻訳。frontend が ⟦N⟧ を元 HTML に復元 + editor 描画。
        #
        # BARSOUL 2026-05-31 (hechun): **内容ハッシュキャッシュ**。旧実装はこの
        # override 経路で cache を一切読み書きせず毎回 LLM → ページ開く度に再翻訳
        # (ユーザ指摘)。masked text の sha256 で (comment, target_lang) 行を引き、
        # hash 一致なら DB hit(~5ms)即返(LLM 無し)。comment 編集→hash 変化→自然 miss
        # 再翻訳(self-invalidating, edit hook 不要)。tokenize は決定論的(同 HTML→
        # 同 ⟦N⟧ 順)なので masked 訳文 cache + frontend 都度 detokenize で整合。
        override_text = (request.data or {}).get("text", "")
        if override_text and override_text.strip():
            o_src = (request.data or {}).get("source", "").strip().lower()[:2]
            o_src = o_src if o_src in ("zh", "ja") else (_detect_src(override_text) or "auto")
            o_tgt = target_lang[:2]
            if o_src == o_tgt:
                return Response({"text": "", "by": "noop:same-lang", "skip": True})

            src_hash = _hashlib.sha256(override_text.encode("utf-8")).hexdigest()

            # ① cache hit: (comment, target_lang) で hash 一致 → 即返(LLM 無し)
            crow = CommentTranslation.all_objects.filter(
                comment=comment, target_lang=o_tgt).first()
            if (crow and not crow.deleted_at and crow.text
                    and crow.source_hash == src_hash):
                return Response({
                    "text": crow.text, "source_lang": crow.source_lang,
                    "by": crow.translated_by, "cached": True})

            # ② miss: 翻訳 → upsert(hash 同梱)。issue 件名 context で主语推断補強。
            # 翻訳は hy-mt2 一本(専用 MT)。cloud Claude/4b は下線済(前者 launchd 非
            # TTY で 30s hang, 後者通用 4B 品質低)。
            _ctx = ""
            try:
                _iss = Issue.objects.filter(pk=issue_id).only("name").first()
                if _iss and _iss.name:
                    _ctx = _iss.name
            except Exception:
                pass
            t = _call_llm(override_text, o_src, o_tgt, context=_ctx)
            if not t:
                return Response({"error": "translation failed"}, status=status.HTTP_502_BAD_GATEWAY)
            _m = globals().get("_last_model_used") or ""
            _by = f"ondemand:{_m}" if (_m and not _m.startswith("ondemand")) else (_m or "ondemand")
            try:
                if crow:  # 既存行(別 hash / soft-deleted)を上書き復活
                    crow.text = t
                    crow.source_hash = src_hash
                    crow.source_lang = o_src if o_src != "auto" else crow.source_lang
                    crow.translated_by = _by
                    crow.deleted_at = None
                    crow.updated_by_id = request.user.id
                    crow.save()
                else:
                    CommentTranslation.objects.create(
                        comment=comment, target_lang=o_tgt,
                        project_id=project_id, workspace_id=comment.workspace_id,
                        text=t, source_lang=o_src, source_hash=src_hash,
                        translated_by=_by,
                        created_by_id=request.user.id,
                        updated_by_id=request.user.id)
            except Exception:
                logger.exception("override translate cache upsert failed (非致命)")
            return Response({"text": t, "source_lang": o_src,
                             "by": _by, "cached": False})

        # 先に src_text を計算 (cache quality check で再利用).
        src_text = _strip(comment.comment_html or "")

        # Cache hit (含 soft-deleted 复活) + 質量門 (2026-05-27 hechun).
        # 背景: ai-bot autotranslate (translated_by 前缀 'aichan') の多 pass 翻訳は
        #   hy-mt2 → gemma → :8094 連鎖中の任意 step で truncate / 段落塌陷 が起き、
        #   結果 cache が「原文 5 段 → 訳文 1 段」「原文 681 字 → 訳文 122 字」など
        #   重欠訳のまま固着する事故が継続 (hechun 截图実証).
        # 修法: cache hit でも 2 つの heuristic で品質判定し、failing なら soft-delete
        #   して _call_llm (我々が修した段落保持 prompt + fallback chain) に回す.
        #   ① 段落数大幅欠落: src ≥3 段 + tgt <50% で revoke
        #   ② 文字数大幅欠落: src ≥200 字 + tgt <40% で revoke
        # 健全 cache は今まで通り即返 (P95 のレイテンシ温存).
        cache = CommentTranslation.all_objects.filter(
            comment=comment, target_lang=target_lang
        ).first()
        if cache and not cache.deleted_at and cache.text:
            _src_paras = src_text.count("\n\n") + 1 if src_text else 0
            _tgt_paras = (cache.text or "").count("\n\n") + 1
            _src_chars = len(src_text or "")
            _tgt_chars = len(cache.text or "")
            _bad_paras = _src_paras >= 3 and _tgt_paras < _src_paras * 0.5
            _bad_chars = _src_chars >= 200 and _tgt_chars < _src_chars * 0.4
            if _bad_paras or _bad_chars:
                logger.info(
                    f"cache quality FAIL cid={comment.id} "
                    f"by={cache.translated_by} "
                    f"paras src={_src_paras} tgt={_tgt_paras} "
                    f"chars src={_src_chars} tgt={_tgt_chars} → re-translate"
                )
                cache.deleted_at = timezone.now()
                cache.save()
                cache = None  # fall through to LLM
            else:
                return Response({
                    "text": cache.text, "source_lang": cache.source_lang,
                    "by": cache.translated_by, "cached": True,
                })

        # Cache miss → LLM (src_text 已经在上面算好了)
        if not src_text:
            return Response({"error": "empty source"}, status=status.HTTP_400_BAD_REQUEST)
        src = _detect_src(src_text) or "auto"
        # BARSOUL 2026-05-27: src == tgt なら LLM 呼出禁止(ゴミ翻訳防御).
        # frontend がここまで来ない筈だが多層防御. 200 で空 text + noop フラグ返却
        # → frontend は表示せず button も「同言語」表示で UX 自然.
        if src == target_lang:
            return Response({
                "text": "", "source_lang": src,
                "by": "noop:same-lang", "cached": False, "skip": True,
            })
        # BARSOUL 2026-05-31 (hechun): 翻訳は hy-mt2 一本(専用 1.8B MT)。
        # cloud Claude(CLI 30s+ hang)と汎用 4B(品質低)を両方下線 → クリーン
        # 1 段路。issue 件名 context だけ温存(主语推断補強, BS-150 c1 fix)。
        _ctx = ""
        try:
            _iss = Issue.objects.filter(pk=issue_id).only("name").first()
            if _iss and _iss.name:
                _ctx = _iss.name
        except Exception:
            pass
        translated = _call_llm(src_text, src, target_lang, context=_ctx)
        if not translated:
            return Response({"error": "translation failed"}, status=status.HTTP_502_BAD_GATEWAY)
        # BARSOUL: 记录实际命中的模型(fallback chain 可能用 default / gemma-4-26b
        # 而非 hy-mt2),格式 "ondemand:{model}",aichan-live 派生 watcher 可统计
        # 模型 mix。无 model 信息(理论上不应发生)兜底为 "ondemand"。
        _model = globals().get("_last_model_used") or ""
        translated_by = f"ondemand:{_model}" if _model else "ondemand"

        if cache:  # revive soft-deleted
            cache.text = translated
            cache.source_lang = src if src != "auto" else cache.source_lang
            cache.translated_by = translated_by
            cache.deleted_at = None
            cache.updated_by_id = request.user.id
            cache.save()
        else:
            CommentTranslation.objects.create(
                comment=comment, target_lang=target_lang,
                project_id=project_id, workspace_id=comment.workspace_id,
                text=translated, source_lang=src,
                translated_by=translated_by,
                created_by_id=request.user.id, updated_by_id=request.user.id,
            )
        return Response({
            "text": translated, "source_lang": src,
            "by": translated_by, "cached": False,
        })


class CommentReactionViewSet(BaseViewSet):
    serializer_class = CommentReactionSerializer
    model = CommentReaction

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(comment_id=self.kwargs.get("comment_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .order_by("-created_at")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, comment_id):
        try:
            serializer = CommentReactionSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(
                    project_id=project_id,
                    actor_id=request.user.id,
                    comment_id=comment_id,
                )
                issue_activity.delay(
                    type="comment_reaction.activity.created",
                    requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                    actor_id=str(request.user.id),
                    issue_id=None,
                    project_id=str(project_id),
                    current_instance=None,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "Reaction already exists for the user"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def destroy(self, request, slug, project_id, comment_id, reaction_code):
        comment_reaction = CommentReaction.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            comment_id=comment_id,
            reaction=reaction_code,
            actor=request.user,
        )
        issue_activity.delay(
            type="comment_reaction.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "reaction": str(reaction_code),
                    "identifier": str(comment_reaction.id),
                    "comment_id": str(comment_id),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        comment_reaction.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
