/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import { useHashScroll } from "@plane/hooks";
import { GlobeIcon, LockIcon } from "@plane/propel/icons";
import { EIssueCommentAccessSpecifier } from "@plane/types";
import type { TCommentsOperations, TIssueComment } from "@plane/types";
import { calculateTimeAgo, cn, getFileURL, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// local imports
import { CommentReactions } from "../comment-reaction";
import { CommentCardEditForm } from "./edit-form";
import { EmojiReactionButton, EmojiReactionPicker } from "@plane/propel/emoji-reaction";
import { Avatar, Tooltip } from "@plane/ui";
import { useTranslation } from "@plane/i18n";
import { useMember } from "@/hooks/store/use-member";

// BARSOUL: 評論翻訳派生層 — X 式 UX。**目標言語 = 閲覧者の言語**。
//  - 外国語(閲覧者言語でない)コメント → 既定で訳文表示(cache 即時/無ければ自動取得)、
//    「显示原文」で原文へ。自言語コメントは翻訳 UI なし。
//  - 原 comment_html は不可変(真相)。translations は API 派生キャッシュ。
//  - AI 自身のコメントは対象外(自分翻訳ループ防止)。
const AI_USER_ID = "0e50881c-df94-4233-ad7e-65f943f62550"; // 愛ちゃん

// 文字種探知 → 起点言語推定(2026-05-27 比率ベース修正)
// 旧: 任意 1 文字でも假名なら ja 判定 → 中文 95% + 日文名 5% でも ja 誤判
// → ja→zh 翻訳要求 → LLM 中文 rephrasing でゴミ翻訳出力. (実例 BS-127
// 「李美京小姐的合同...そうさん的公司」)
// 新: 假名 / 漢字 比率で判定. 假名 ≥ 20% → 純粋日文. 純粋中文には假名はゼロ
// な前提を活用、混在テキストも多数派側に倒す.
const HK_RE_G = /[぀-ゟ゠-ヿ]/g;
const HAN_RE_G = /[一-鿿]/g;
// BARSOUL 2026-06-05 (hechun, BS-226): 混合言語判定。中文母语者が中文コメントに
// 日本サイト(MonotaRO 等)の日文素材を貼ると、素材ブロックの假名密度で全体比率が
// 0.2 を超え(実測 0.207)、地の文は中文なのに ja 誤判 → 「翻訳元 日語」表示 +
// 訳方向が狂う。比率では混合を取れない。中日"専属"記号の共存で混合を検出し、
// 地の文(主体)の言語を src とする。バックエンド _is_mixed_cn_ja と対称。
const KANA_STRICT_G = /[ぁ-ゟァ-ヺ]/g; // 中日共用の ・(30FB) ー(30FC) を除外
// BS-226 第2波 (2026-06-05 hechun): 句読点「，？！」依存は脆い(中文が「。」で
// 終わると取りこぼし→ja 誤判→中文まで改写)。日文がまず使わない簡体字・常用語の
// 共存で判定。バックエンド _is_mixed_cn_ja と同字種。
const CN_CHARS_G = /[的了们这那是不在有和与将把给为对你我他她它没么呢吧吗很真还会能要看请帮做想说让跟从向当其它别也都就最较关联报价当前一起展示确认问题方案折扣优惠]/g;
function isMixedCnJa(text: string): boolean {
  const kana = (text.match(KANA_STRICT_G) || []).length;
  if (kana < 6) return false; // 日文素材が薄い → 従来判定でよい
  const cn = (text.match(CN_CHARS_G) || []).length;
  return cn >= 3; // 中文の地の文(専属字>=3) + 実質日文 = 混合
}
function detectSrc(text: string): "ja" | "zh" | null {
  // 混合(中文地の文 + 日文素材)は地の文=中文 → src=zh(「翻訳元」も訳方向も
  // 中文起点に。読み手が日本人なら zh→ja で日本語化される)。
  if (isMixedCnJa(text)) return "zh";
  const kana = (text.match(HK_RE_G) || []).length;
  const han = (text.match(HAN_RE_G) || []).length;
  const total = kana + han;
  if (total === 0) return null;
  // 假名比率 ≥ 20% → 日文(純粋日文は 30-50%、中文は 0%、閾値 20% で安全分離)
  if (kana / total >= 0.2) return "ja";
  if (han > 0) return "zh";
  return null;
}
// 翻訳元アイコン(X の "⌀" 相当のミニ globe)。
const TranslateGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
  </svg>
);

// 言語コード短名(表示用)。
const LANG_NAME: Record<string, { zh: string; ja: string }> = {
  ja: { zh: "日语", ja: "日本語" },
  zh: { zh: "中文", ja: "中国語" },
};

// ── 全局自動翻訳プリファレンス (localStorage, 既定 ON / X 式) ──────────────
// ⚙️ 歯車から切替。OFF → 外国語コメントは既定で原文表示 +「显示翻译」リンク。
// 変更は storage / custom event で全マウント済コメントへ即時伝播(live)。
const AUTO_TR_KEY = "barsoul.autoTranslate";
const AUTO_TR_EVENT = "barsoul:autoTranslate";
function readAutoTr(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AUTO_TR_KEY) !== "0"; // 既定 true
}
function useAutoTranslatePref(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(readAutoTr);
  useEffect(() => {
    const h = () => setV(readAutoTr());
    window.addEventListener("storage", h);
    window.addEventListener(AUTO_TR_EVENT, h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener(AUTO_TR_EVENT, h);
    };
  }, []);
  const set = useCallback((nv: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_TR_KEY, nv ? "1" : "0");
    window.dispatchEvent(new Event(AUTO_TR_EVENT));
  }, []);
  return [v, set];
}

// ── 富文本 tokenize/rebuild: 画像/@mention を ⟦N⟧ 占位符化して翻訳 → 復元 ──
// 翻訳は文字のみ、画像(image-component)/メンション(mention-component)は
// 原 HTML をそのまま保持 → 訳文も read-only editor で描画 → 画像表示 + @名前解決。
const RICH_NODE_RE = /<(mention-component|image-component)\b[^>]*><\/\1>/gi;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tokenizeHtml(html: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const placed = (html || "").replace(RICH_NODE_RE, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return ` ⟦${i}⟧ `;
  });
  const text = placed
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, tokens };
}

function rebuildHtml(translated: string, tokens: string[]): string {
  const paras = translated.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = paras.map((p) => {
    const sole = p.match(/^⟦(\d+)⟧$/);
    if (sole) {
      const tok = tokens[Number(sole[1])];
      if (tok && /^<image-component/i.test(tok)) return tok; // ブロック画像は <p> で包まない
    }
    const body = escapeHtml(p).replace(/⟦(\d+)⟧/g, (_m, i) => tokens[Number(i)] ?? "");
    return `<p class="editor-paragraph-block">${body}</p>`;
  });
  return out.join("") || "<p></p>";
}

const stripTokens = (s: string) => s.replace(/⟦\d+⟧/g, "");
const otherLang = (l: "zh" | "ja"): "zh" | "ja" => (l === "zh" ? "ja" : "zh");

// 行内「自動翻訳」トグル(popover 廃止 — 定位ライブラリ不要 = 絶対壊れない)。
// 説明は Tooltip(Plane 標準、衝突回避済)。
function InlineAutoToggle(props: { enabled: boolean; onChange: (v: boolean) => void; viewer: "zh" | "ja" }) {
  const { enabled, onChange, viewer } = props;
  const T = viewer === "zh"
    ? { label: "自动翻译", on: "开", off: "关", tip: "外语评论自动译成你的语言。关闭后默认显示原文。" }
    : { label: "自動翻訳", on: "ON", off: "OFF", tip: "外国語コメントを自動で日本語へ。OFF で既定は原文表示。" };
  return (
    <Tooltip tooltipContent={T.tip} position="top-left">
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className="inline-flex items-center gap-1 hover:text-secondary transition-colors outline-none"
        aria-pressed={enabled}
      >
        <span>{T.label}</span>
        <span className={enabled ? "text-accent-primary font-medium" : "opacity-50"}>
          {enabled ? T.on : T.off}
        </span>
      </button>
    </Tooltip>
  );
}

// BARSOUL 評論翻訳 v3 (2026-05-30 hechun):
//  ・目標言語 = 閲覧者言語(外国語コメント)/ 自言語コメントは相手言語へ「プレビュー」。
//  ・訳文は ⟦N⟧ tokenize → 翻訳 → 復元 → read-only editor 描画(画像 + @mention 保持)。
//  ・設定は行内トグル(popover 廃止)。
function CommentTranslatable(props: {
  workspaceSlug: string;
  workspaceId: string;
  projectId: string;
  issueId: string;
  comment: any;
  actorId: string | undefined;
  children: ReactNode; // 原文 (read-only LiteTextEditor)
}) {
  const { workspaceSlug, workspaceId, projectId, issueId, comment, actorId, children } = props;
  const { currentLocale } = useTranslation();
  const viewer: "zh" | "ja" = currentLocale === "ja" ? "ja" : "zh";
  const trEditorRef = useRef<EditorRefApi>(null);

  // comment_html を tokenize(画像/@mention を占位符化)
  const { text: tokenText, tokens } = useMemo(
    () => tokenizeHtml(comment?.comment_html || ""),
    [comment?.comment_html]
  );
  const plainText = stripTokens(tokenText);
  const src = detectSrc(plainText);
  const isAi = actorId === AI_USER_ID;
  // 翻訳 UI を出せる条件(自言語でも「プレビュー」として出す)
  const canTranslate = !!src && !isAi && !!plainText.trim();
  const isSelf = !!src && src === viewer;
  const target: "zh" | "ja" = isSelf ? otherLang(src as "zh" | "ja") : viewer;

  const [autoPref, setAutoPref] = useAutoTranslatePref();
  const [override, setOverride] = useState<boolean | null>(null); // null=既定追随 / true=原文 / false=訳文
  const [trHtml, setTrHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // 既定: 自言語=原文(プレビューは opt-in)/ 外国語=全局 autoPref に従う。
  const showOriginalEff = override !== null ? override : isSelf ? true : !autoPref;
  const wantTranslation = canTranslate && !showOriginalEff;

  // BARSOUL 2026-05-31: force=true で手動リトライ(fetchedRef ガードを跨ぐ)。
  // 旧実装は失敗後 fetchedRef=true のままで二度と再取得できなかった(hechun 指摘)。
  // hy-mt2 はメモリ圧でコールドスタート時に間欠 timeout する → リトライで殆ど回復。
  const doFetch = useCallback(async (force = false) => {
    if (fetchedRef.current && !force) return;
    fetchedRef.current = true;
    setErrorMsg(null);
    setLoading(true);
    try {
      const r = await fetch(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments/${comment.id}/translate/`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ target_lang: target, text: tokenText, source: src }),
        }
      );
      const j = await r.json();
      // 生エラー文("translation failed")は出さず、穏やかな再試行可能メッセージに。
      if (!r.ok) setErrorMsg(viewer === "zh" ? "翻译暂时不可用" : "翻訳が一時的に失敗しました");
      else setTrHtml(rebuildHtml(j.text || "", tokens));
    } catch {
      setErrorMsg(viewer === "zh" ? "网络错误，请重试" : "ネットワークエラー、再試行してください");
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, projectId, issueId, comment.id, target, tokenText, src, tokens, viewer]);

  useEffect(() => {
    if (wantTranslation && !trHtml && !fetchedRef.current) doFetch();
  }, [wantTranslation, trHtml, doFetch]);

  if (!canTranslate) return <>{children}</>;

  const tgtName = LANG_NAME[target][viewer];
  const srcName = LANG_NAME[src!][viewer];
  const L = viewer === "zh"
    ? {
        showOrig: "显示原文",
        showTr: isSelf ? `查看${tgtName}译文` : "显示译文",
        from: isSelf ? `机器译文 · ${tgtName}` : `翻译自 ${srcName}`,
        loading: "翻译中…",
      }
    : {
        showOrig: "原文を表示",
        showTr: isSelf ? `${tgtName}訳を見る` : "訳文を表示",
        from: isSelf ? `機械翻訳 · ${tgtName}` : `${srcName}から翻訳`,
        loading: "翻訳中…",
      };

  const showingTranslation = !!trHtml && wantTranslation;

  return (
    <div className="select-none">
      {/* コントロール行(本文の上 = Y 固定、往復切替でマウス移動不要)。 */}
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-tertiary">
        <TranslateGlyph />
        {loading ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-3 border border-tertiary border-t-transparent rounded-full animate-spin" />
            {L.loading}
          </span>
        ) : (
          <button type="button" onClick={() => setOverride(showingTranslation)} className="text-accent-primary hover:underline">
            {showingTranslation ? L.showOrig : L.showTr}
          </button>
        )}
        {showingTranslation && (
          <>
            <span className="opacity-50">·</span>
            <span>{L.from}</span>
          </>
        )}
        <span className="flex-1" />
        <InlineAutoToggle enabled={autoPref} onChange={setAutoPref} viewer={viewer} />
      </div>

      {/* 訳文: rebuild した HTML を read-only editor で描画 → 画像 + @mention 保持。 */}
      {showingTranslation && trHtml && (
        <LiteTextEditor
          editable={false}
          ref={trEditorRef}
          id={`${comment.id}-tr-${target}`}
          initialValue={trHtml}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          containerClassName="!py-1"
          projectId={projectId?.toString()}
          displayConfig={{ fontSize: "small-font" }}
          parentClassName="border-none"
        />
      )}
      {/* 原文: 訳文表示中は CSS 隠し(unmount せず editor ref 保持)。 */}
      <div className={showingTranslation ? "hidden" : "block"}>{children}</div>

      {errorMsg && !loading && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-tertiary">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => void doFetch(true)}
            className="text-accent-primary hover:underline"
          >
            {viewer === "zh" ? "重试" : "再試行"}
          </button>
        </div>
      )}
    </div>
  );
}

export type TCommentCardDisplayProps = {
  activityOperations: TCommentsOperations;
  comment: TIssueComment;
  disabled: boolean;
  entityId: string;
  projectId?: string;
  readOnlyEditorRef: React.RefObject<EditorRefApi>;
  showAccessSpecifier: boolean;
  workspaceId: string;
  workspaceSlug: string;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  renderFooter?: (ReactionsComponent: ReactNode | null) => ReactNode;
  renderQuickActions?: () => ReactNode;
};

export const CommentCardDisplay = observer(function CommentCardDisplay(props: TCommentCardDisplayProps) {
  const {
    activityOperations,
    comment,
    disabled,
    projectId,
    readOnlyEditorRef,
    showAccessSpecifier,
    workspaceId,
    workspaceSlug,
    isEditing = false,
    setIsEditing,
    renderFooter,
    renderQuickActions,
  } = props;
  // states
  const [highlightClassName, setHighlightClassName] = useState("");
  // state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // store hooks
  const { getUserDetails } = useMember();
  // derived values
  const userDetails = getUserDetails(comment?.actor);
  const displayName = comment?.actor_detail?.is_bot
    ? comment?.actor_detail?.first_name + `Bot`
    : (userDetails?.display_name ?? comment?.actor_detail?.display_name);
  const avatarUrl = userDetails?.avatar_url ?? comment?.actor_detail?.avatar_url;

  const userReactions = activityOperations.userReactions(comment.id);

  // navigation
  const pathname = usePathname();
  // derived values
  const commentBlockId = `comment-${comment?.id}`;
  // Check if there are any reactions to determine if we should render the footer
  const reactionIds = activityOperations.reactionIds(comment.id);
  const hasReactions = reactionIds && Object.keys(reactionIds).some((key) => reactionIds[key]?.length > 0);

  // scroll to comment
  const { isHashMatch } = useHashScroll({
    elementId: commentBlockId,
    pathname,
  });

  useEffect(() => {
    if (!isHashMatch) return;
    setHighlightClassName("border-accent-strong");
    const timeout = setTimeout(() => {
      setHighlightClassName("");
    }, 8000);

    return () => clearTimeout(timeout);
  }, [isHashMatch]);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      if (!userReactions) return;
      // emoji is already in decimal string format from EmojiReactionPicker
      void activityOperations.react(comment.id, emoji, userReactions);
    },
    [activityOperations, comment.id, userReactions]
  );

  const shouldRenderReactions = hasReactions && !disabled;

  return (
    <div id={commentBlockId} className="relative flex flex-col gap-2">
      {showAccessSpecifier && (
        <div className="absolute top-2.5 right-2.5 z-[1] text-tertiary">
          {comment.access === EIssueCommentAccessSpecifier.INTERNAL ? (
            <LockIcon className="size-3" />
          ) : (
            <GlobeIcon className="size-3" />
          )}
        </div>
      )}
      <div className="relative mb-3 flex w-full items-center gap-2">
        <Avatar size="sm" name={displayName} src={getFileURL(avatarUrl)} className="shrink-0" />
        <div className="flex flex-1 flex-wrap items-center gap-1">
          <div className="text-caption-sm-medium">{displayName}</div>
          <div className="text-caption-sm-regular text-tertiary">
            commented{" "}
            <Tooltip
              tooltipContent={`${renderFormattedDate(comment.created_at)} at ${renderFormattedTime(comment.created_at)}`}
              position="bottom"
            >
              <span className="text-tertiary">
                {calculateTimeAgo(comment.created_at)}
                {comment.edited_at && " (edited)"}
              </span>
            </Tooltip>
          </div>
        </div>
        {!disabled && (
          <div className="flex shrink-0 items-center gap-1">
            <EmojiReactionPicker
              isOpen={isPickerOpen}
              handleToggle={setIsPickerOpen}
              onChange={handleEmojiSelect}
              disabled={disabled}
              label={<EmojiReactionButton onAddReaction={() => setIsPickerOpen(true)} />}
              placement="bottom-start"
            />
            {renderQuickActions ? renderQuickActions() : null}
          </div>
        )}
      </div>
      {isEditing && setIsEditing ? (
        <CommentCardEditForm
          activityOperations={activityOperations}
          comment={comment}
          isEditing={isEditing}
          readOnlyEditorRef={readOnlyEditorRef.current}
          setIsEditing={setIsEditing}
          projectId={projectId}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
        />
      ) : (
        <>
          {/* BARSOUL: 評論翻訳 X 式 UX — 原文(editor)を wrap し、訳文表示時は
              原文を CSS で隠して訳文に置換 + 「翻訳自 X · 显示原文」ヘッダ。 */}
          <CommentTranslatable
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            projectId={String(projectId || "")}
            issueId={String((comment as any).issue || "")}
            comment={comment}
            actorId={comment?.actor}
          >
            <LiteTextEditor
              editable={false}
              ref={readOnlyEditorRef}
              id={comment.id}
              initialValue={comment.comment_html ?? ""}
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              containerClassName={cn("!py-1 transition-[border-color] duration-500", highlightClassName)}
              projectId={projectId?.toString()}
              displayConfig={{
                fontSize: "small-font",
              }}
              parentClassName="border-none"
            />
          </CommentTranslatable>
          {shouldRenderReactions &&
            (renderFooter ? (
              renderFooter(
                <CommentReactions comment={comment} disabled={disabled} activityOperations={activityOperations} />
              )
            ) : (
              <CommentReactions comment={comment} disabled={disabled} activityOperations={activityOperations} />
            ))}
        </>
      )}
    </div>
  );
});
