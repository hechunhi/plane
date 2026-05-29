/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
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
import { useMember } from "@/hooks/store/use-member";

// BARSOUL: 評論翻訳派生層 — X 式 UX (即点即译, 永遠ボタン表示)。
// 設計:
//  - 異言語コメントには常に下部小リンク「翻訳 / 翻译」を出す(X/Twitter 範式)
//  - クリック → キャッシュ命中=即展開, 未命中=loading→LLM→展開
//  - 原 comment_html は不可変(真相)。translations は API 派生キャッシュ。
//  - AI 自身のコメントは対象外(自分翻訳ループ防止)
// localStorage `aichan.autoTranslateOpen` で「自動で全て展開」プリファレンス。
const TR_AUTO_KEY = "aichan.autoTranslateOpen";
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
// 起点→目標(本チームは日中双方向): ja→zh, zh→ja
function targetFor(src: "ja" | "zh"): "ja" | "zh" {
  return src === "ja" ? "zh" : "ja";
}
// 起点+目標 → 読者言語(=tgt)向けの文言セット(X 式: 翻訳自 X · 显示原文)
function trLabels(src: "ja" | "zh") {
  const tgt = targetFor(src);
  return tgt === "zh"
    ? { trigger: "翻译", loading: "翻译中…", from: "翻译自 日语", showOrig: "显示原文" }
    : { trigger: "翻訳", loading: "翻訳中…", from: "中国語から翻訳", showOrig: "原文を表示" };
}

// 翻訳元アイコン(X の "⌀" 相当のミニ globe)。
const TranslateGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
  </svg>
);

// BARSOUL 評論翻訳 X 式 UX (2026-05-30 hechun): 既定は原文表示 + 下に控えめな
// 「🌐 翻訳」リンク。クリック → 原文を訳文で置換 + 上部に「🌐 翻訳自 X · 显示原文」
// ヘッダ。「显示原文」で原文に戻る。原文(children)は CSS で隠すだけ(unmount せず
// editor ref を保持 → 編集モード遷移を壊さない)。
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
  const src = detectSrc(commentText);
  const isAi = actorId === AI_USER_ID;

  const cachedFromServer = src ? (comment?.translations as any)?.[targetFor(src)] : null;
  const [autoOpen, setAutoOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TR_AUTO_KEY) === "1";
  });
  const [text, setText] = useState<string | null>(cachedFromServer?.text || null);
  const [showTr, setShowTr] = useState<boolean>(!!(autoOpen && cachedFromServer?.text));
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (autoOpen && text) setShowTr(true);
  }, [autoOpen, text]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === TR_AUTO_KEY) setAutoOpen(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 異言語でない / AI コメント / 空 → 翻訳 UI なしで原文のみ
  if (!src || isAi || !commentText.trim()) return <>{children}</>;

  const tgt = targetFor(src);
  const L = trLabels(src);

  const doFetch = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const r = await fetch(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments/${comment.id}/translate/`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ target_lang: tgt }),
        }
      );
      const j = await r.json();
      if (!r.ok) setErrorMsg(j?.error || `翻译失败 (${r.status})`);
      else {
        setText(j.text || "");
        setShowTr(true);
      }
    } catch {
      setErrorMsg("ネットワーク错误 / 网络错误");
    } finally {
      setLoading(false);
    }
  };

  const showTranslation = () => (text ? setShowTr(true) : doFetch());
  const toggleAuto = (e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    const next = !autoOpen;
    setAutoOpen(next);
    if (typeof window !== "undefined") window.localStorage.setItem(TR_AUTO_KEY, next ? "1" : "0");
  };

  const translating = showTr && !!text;

  return (
    <div className="select-none">
      {/* 原文: 訳文表示中は CSS で隠す(unmount しないので editor ref 保持) */}
      <div className={translating ? "hidden" : "block"}>{children}</div>

      {translating ? (
        // ── X 式 訳文ビュー: ヘッダ(翻訳自 X · 显示原文) + 訳文 ──
        <div className="mt-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-tertiary mb-1">
            <TranslateGlyph />
            <span>{L.from}</span>
            <span className="opacity-50">·</span>
            <button
              type="button"
              onClick={() => setShowTr(false)}
              className="text-accent-primary hover:underline"
            >
              {L.showOrig}
            </button>
          </div>
          <div className="text-caption-sm-regular text-primary whitespace-pre-wrap leading-relaxed">
            {text}
          </div>
        </div>
      ) : (
        // ── 原文ビュー: 控えめな「🌐 翻訳」トリガ ──
        <div className="mt-1 flex items-center gap-3 text-[11px] text-tertiary">
          <button
            type="button"
            onClick={showTranslation}
            disabled={loading}
            className="inline-flex items-center gap-1 hover:text-secondary hover:underline transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            {loading ? (
              <>
                <span className="inline-block size-3 border border-tertiary border-t-transparent rounded-full animate-spin" />
                {L.loading}
              </>
            ) : (
              <>
                <TranslateGlyph />
                {L.trigger}
              </>
            )}
          </button>
          {!loading && (
            <label className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer flex items-center gap-1">
              <input type="checkbox" checked={autoOpen} onChange={toggleAuto} className="size-2.5 cursor-pointer" />
              <span>自動展開 / 自动展开</span>
            </label>
          )}
        </div>
      )}
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
