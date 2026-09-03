/**
 * BARSOUL コメント返信 A 案 (hechun 2026-09-03): カード上端の引用一行。
 * 設計の背景は ../reply-context.tsx を見よ。
 */

import { observer } from "mobx-react";
import { CornerUpLeft } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
// local imports
import { focusCommentInPlace } from "../reply-context";
import { htmlToPlain } from "./display";

type TCommentReplyQuote = {
  /** 返信先コメント id (IssueComment.parent)。 */
  parentId: string;
};

/** 引用一行に載せる長さ。これ以上は元コメントを開いて読む。 */
const QUOTE_MAX = 140;

/**
 * 引用一行の中身(作者名・抜粋・親が消えているか)。カード上端の引用行と、
 * 入力欄の上に出す「今これに返している」帯の **両方** が同じ字面になるように
 * 一箇所で作る。
 */
export const useCommentQuotePreview = (parentId: string | undefined) => {
  const {
    comment: { getCommentById },
  } = useIssueDetail();
  const { getUserDetails } = useMember();

  const parent = parentId ? getCommentById(parentId) : undefined;
  // 親が削除済み(soft delete)だと store に無い。**引用行自体は消さない** —
  // 「消えた何かへの返事」だと分かる方が、文脈が黙って落ちるより読める。
  // backend 側も soft delete では parent id を残す (bgtasks/deletion_task.py)。
  const isDeleted = !!parentId && !parent;
  const authorDetails = parent ? getUserDetails(parent.actor) : undefined;
  const authorName = parent?.actor_detail?.is_bot
    ? `${parent?.actor_detail?.first_name}Bot`
    : (authorDetails?.display_name ?? parent?.actor_detail?.display_name ?? "—");
  const quote = parent ? htmlToPlain(parent.comment_html ?? "").slice(0, QUOTE_MAX) : "";

  return { isDeleted, authorName, quote };
};

export const CommentReplyQuote = observer(function CommentReplyQuote(props: TCommentReplyQuote) {
  const { parentId } = props;
  const { t } = useTranslation();
  const { isDeleted, authorName, quote } = useCommentQuotePreview(parentId);

  return (
    <button
      type="button"
      disabled={isDeleted}
      onClick={() => {
        if (isDeleted) return;
        focusCommentInPlace(parentId);
      }}
      aria-label={isDeleted ? t("issue.comments.reply.deleted") : t("issue.comments.reply.jump_to_original")}
      className={cn(
        "mb-2 flex max-w-full items-center gap-1.5 rounded border-l-2 border-subtle py-0.5 pr-1 pl-2 text-left",
        isDeleted ? "cursor-default" : "hover:border-accent-strong hover:bg-layer-2"
      )}
    >
      <CornerUpLeft className="size-3 shrink-0 text-placeholder" strokeWidth={2} />
      {isDeleted ? (
        <span className="text-[11px] text-placeholder italic">{t("issue.comments.reply.deleted")}</span>
      ) : (
        <>
          <span className="shrink-0 text-[11px] font-medium text-secondary">{authorName}</span>
          <span className="min-w-0 truncate text-[11px] text-tertiary">{quote}</span>
        </>
      )}
    </button>
  );
});
