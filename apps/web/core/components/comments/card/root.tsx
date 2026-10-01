/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { ReplyIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
// local imports
import { CommentQuickActions } from "../quick-actions";
import { useCommentReply } from "../reply-context";
import { CommentReplyQuote } from "./reply-quote";
import { CommentBlock } from "../comment-block";
import { CommentCardDisplay } from "./display";

type TCommentCard = {
  workspaceSlug: string;
  entityId: string;
  comment: TIssueComment | undefined;
  activityOperations: TCommentsOperations;
  ends: "top" | "bottom" | undefined;
  showAccessSpecifier: boolean;
  showCopyLinkOption: boolean;
  enableReplies: boolean;
  disabled?: boolean;
  projectId?: string;
};

export const CommentCard = observer(function CommentCard(props: TCommentCard) {
  const {
    workspaceSlug,
    entityId,
    comment,
    activityOperations,
    ends,
    showAccessSpecifier,
    showCopyLinkOption,
    disabled = false,
    projectId,
    enableReplies,
  } = props;
  // i18n
  const { t } = useTranslation();
  // BARSOUL: 返信の意図(どのコメントに返すか)は入力欄と共有する — ../reply-context.tsx
  const { replyToId, setReplyToId } = useCommentReply();
  // states
  const [isEditing, setIsEditing] = useState(false);
  // refs
  const readOnlyEditorRef = useRef<EditorRefApi>(null);
  // derived values
  const workspaceId = comment?.workspace;

  if (!comment || !workspaceId) return null;

  return (
    <CommentBlock comment={comment} ends={ends}>
      <CommentCardDisplay
        activityOperations={activityOperations}
        entityId={entityId}
        comment={comment}
        disabled={disabled}
        projectId={projectId}
        readOnlyEditorRef={readOnlyEditorRef}
        showAccessSpecifier={showAccessSpecifier}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        renderReplyQuote={
          // BARSOUL: 上流の parent は前からある FK。引用一行はそれを読むだけ。
          enableReplies && comment.parent ? () => <CommentReplyQuote parentId={comment.parent as string} /> : undefined
        }
        renderQuickActions={() => (
          <>
            {/* BARSOUL: 返信は高頻度の動作なので ⋯ の中に隠さず、絵文字と同じ行に置く。
                もう一度押すと解除 = 押し間違えても行き止まりにならない。 */}
            {enableReplies && !disabled && (
              <IconButton
                icon={ReplyIcon}
                variant="ghost"
                size="sm"
                aria-label={t("issue.comments.reply.action")}
                aria-pressed={replyToId === comment.id}
                // BARSOUL: モバイルは 20px だとタップ不能 → 28px(隣の絵文字/⋯ も同寸)
                className={cn("max-md:size-7", replyToId === comment.id && "text-accent-primary")}
                onClick={() => setReplyToId(replyToId === comment.id ? undefined : comment.id)}
              />
            )}
            <CommentQuickActions
              activityOperations={activityOperations}
              comment={comment}
              setEditMode={() => setIsEditing(true)}
              showAccessSpecifier={showAccessSpecifier}
              showCopyLinkOption={showCopyLinkOption}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
            />
          </>
        )}
      />
    </CommentBlock>
  );
});
