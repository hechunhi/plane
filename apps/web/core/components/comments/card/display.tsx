/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import { useHashScroll, useOutsideClickDetector } from "@plane/hooks";
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
function detectSrc(text: string): "ja" | "zh" | null {
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

const GearGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ⚙️ 自動翻訳 設定ポップオーバ(X の歯車相当)。
function AutoTranslateGear(props: { enabled: boolean; onChange: (v: boolean) => void; viewer: "zh" | "ja" }) {
  const { enabled, onChange, viewer } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useOutsideClickDetector(ref, () => setOpen(false));
  const T = viewer === "zh"
    ? { title: "自动翻译", desc: "外语评论自动译成你的语言。关闭后默认显示原文。", label: "默认自动翻译" }
    : { title: "自動翻訳", desc: "外国語コメントを自動で日本語へ。OFF で既定は原文表示。", label: "既定で自動翻訳" };
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="text-tertiary hover:text-secondary transition-colors"
        aria-label={T.title}
      >
        <GearGlyph />
      </button>
      {open && (
        <div
          // 幅/位置は inline style で確実に効かせる(tailwind 任意値の JIT 取りこぼし回避)。
          // right:0 で歯車の右端基準に左へ展開 → 右端クリップ防止。maxWidth で視口内に収める。
          style={{ width: 240, maxWidth: "calc(100vw - 2rem)", right: 0 }}
          className="absolute z-20 top-5 rounded-md border border-strong bg-surface-1 p-3 shadow-lg text-left cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-12 font-medium text-primary mb-1">{T.title}</div>
          <p className="text-11 text-tertiary leading-relaxed mb-2.5">{T.desc}</p>
          <label className="flex items-center justify-between gap-2 cursor-pointer text-12 text-secondary">
            <span>{T.label}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onChange(e.target.checked)}
              className="size-3.5 cursor-pointer"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// BARSOUL 評論翻訳 X 式 UX v2 (2026-05-30 hechun):
// **目標言語 = 閲覧者の言語**(currentLocale)。閲覧者が中文なら全部中文で読める
// のが既定 — 外国語(=閲覧者言語でない)コメントは既定で訳文を表示(cache あれば
// 即時、無ければ自動取得)、「显示原文」で原文へ。自言語コメントは翻訳 UI 無し。
// 旧実装の致命的欠陥: 目標を src の反対固定 → 中文ユーザが日本語コメントを既定で
// 日本語のまま見せられる(自分の言語に翻訳されない)= 本末転倒。
function CommentTranslatable(props: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  comment: any;
  commentText: string;
  actorId: string | undefined;
  children: ReactNode; // 原文 (read-only LiteTextEditor)
}) {
  const { workspaceSlug, projectId, issueId, comment, commentText, actorId, children } = props;
  const { currentLocale } = useTranslation();
  // 閲覧者言語: zh-CN/zh-TW → zh, ja → ja, それ以外(en 等)は zh 既定(BARSOUL 運用)
  const viewer: "zh" | "ja" = currentLocale === "ja" ? "ja" : "zh";

  const src = detectSrc(commentText);
  const isAi = actorId === AI_USER_ID;
  // 自言語/判定不能/AI/空 → 翻訳不要、原文のみ
  const needTranslate = !!src && !isAi && !!commentText.trim() && src !== viewer;

  const cached = needTranslate ? (comment?.translations as any)?.[viewer]?.text || null : null;
  const [autoPref, setAutoPref] = useAutoTranslatePref();
  // override: null=全局pref追随, true=原文強制, false=訳文強制(ユーザの明示選択)
  const [override, setOverride] = useState<boolean | null>(null);
  const [text, setText] = useState<string | null>(cached);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // 既定の原文/訳文: override 優先、無ければ全局 autoPref(ON→訳文既定)。
  const showOriginalEff = override !== null ? override : !autoPref;
  const wantTranslation = needTranslate && !showOriginalEff;

  const doFetch = useCallback(async () => {
    if (fetchedRef.current) return;
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
          body: JSON.stringify({ target_lang: viewer }),
        }
      );
      const j = await r.json();
      if (!r.ok) setErrorMsg(j?.error || `翻译失败 (${r.status})`);
      else setText(j.text || "");
    } catch {
      setErrorMsg(viewer === "zh" ? "网络错误" : "ネットワーク错误");
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, projectId, issueId, comment.id, viewer]);

  // 訳文を見たい状態 + 未取得 → fetch(全局 ON で mount 時自動 / ユーザが訳文選択時)
  useEffect(() => {
    if (wantTranslation && !cached && !fetchedRef.current) doFetch();
  }, [wantTranslation, cached, doFetch]);

  // 翻訳不要 → 原文のみ(UI 無し)
  if (!needTranslate) return <>{children}</>;

  const srcName = LANG_NAME[src!][viewer];      // 例: viewer=zh, src=ja → "日语"
  const L = viewer === "zh"
    ? { from: `翻译自 ${srcName}`, showOrig: "显示原文", showTr: "显示译文", loading: "翻译中…" }
    : { from: `${srcName}から翻訳`, showOrig: "原文を表示", showTr: "訳文を表示", loading: "翻訳中…" };

  const showingTranslation = !!text && wantTranslation;
  const gear = <AutoTranslateGear enabled={autoPref} onChange={setAutoPref} viewer={viewer} />;

  return (
    <div className="select-none">
      {/* 固定位置 コントロール行(本文の【上】に置く → Y 座標が原文/訳文の高さ差で
          動かない = トグルが常に同じ位置)。トグル文言は 显示原文↔显示译文(4文字
          等幅)で位置不変 → マウス移動なしで往復切替。後続「翻訳自 X」はトグルの
          右なので位置に影響しない。X/Twitter のヘッダ式と同型。 */}
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-tertiary">
        <TranslateGlyph />
        {loading ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-3 border border-tertiary border-t-transparent rounded-full animate-spin" />
            {L.loading}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOverride(showingTranslation)}
            className="text-accent-primary hover:underline"
          >
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
        {gear}
      </div>

      {/* 本文: 訳文 or 原文(原文は unmount せず CSS 隠し → editor ref 保持)。
          訳文の字号/行高は原文 editor(small-font)の本文と完全一致させる:
          --font-size-regular: 0.8rem / --line-height-regular: 1.2rem。
          editor は py-1 のパディングを持つので ここでも合わせる。 */}
      {showingTranslation && (
        <div
          className="text-primary whitespace-pre-wrap py-1"
          style={{ fontSize: "0.8rem", lineHeight: "1.2rem" }}
        >
          {text}
        </div>
      )}
      <div className={showingTranslation ? "hidden" : "block"}>{children}</div>

      {errorMsg && <div className="mt-1 text-[11px] text-red-500">{errorMsg}</div>}
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
            projectId={String(projectId || "")}
            issueId={String((comment as any).issue || "")}
            comment={comment}
            commentText={(comment as any).comment_stripped || ""}
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
