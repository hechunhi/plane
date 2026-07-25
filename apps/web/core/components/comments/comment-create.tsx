/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useForm, Controller } from "react-hook-form";
// plane imports
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import { COMMENT_INTENT_EVENT, buildCommentSlashOptions } from "@plane/editor";
import type { EditorRefApi, TCommentIntentDetail } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
// BARSOUL 2026-06-06: 爱酱发起审批入口(评论框旁图标 → 表单, 替代评论区 @爱酱去污染)
// BARSOUL 2026-07-25: 斜杠命令 —— `/審査` は公開(全員に届く)、`/愛ちゃん` は私聊(自分だけ)
import { AichanApprovalButton } from "@/components/comments/aichan-approval-button";
import { AichanChatPanel } from "@/components/comments/aichan-chat";
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { FileService } from "@/services/file.service";

type TCommentCreate = {
  entityId: string;
  workspaceSlug: string;
  activityOperations: TCommentsOperations;
  showToolbarInitially?: boolean;
  projectId?: string;
  onSubmitCallback?: (elementId: string) => void;
  /** BARSOUL: 私聊パネルの「読んでいる文脈」表示用(任意)。 */
  entityTitle?: string;
};

/**
 * BARSOUL(2026-07-25 hechun「審査を一等市民に」): コメント欄スラッシュ命令の受け皿。
 *
 * 発端: 「審査はどこからでも発起したい。ただし毎回 @愛ちゃん するのは嫌だ」
 *   —— コメント欄は全員に届くので、**依頼という私的な行為** の場所としては誤り。
 *
 * だから二本立てにした。場所は同じコメント欄、違うのは **可視性** だけ:
 *   `/審査`   → 公開。既存の審査モーダル → Temporal(裁決の権威は不変)。
 *   `/愛ちゃん` → 私聊。自分にしか見えない。公開したくなったら明示的に引用する。
 *
 * 可視性は「入口の場所」ではなく「動作の意味」で決める —— これが芯。
 */
type TIntentState = { kind: "approval" | "aichan"; query: string } | null;

// services
const fileService = new FileService();

export const CommentCreate = observer(function CommentCreate(props: TCommentCreate) {
  const {
    workspaceSlug,
    entityId,
    activityOperations,
    showToolbarInitially = false,
    projectId,
    onSubmitCallback,
    entityTitle,
  } = props;
  const { t } = useTranslation();
  // states
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  // BARSOUL: スラッシュ命令で開いた意図(審査モーダル / 愛ちゃん私聊)
  const [intent, setIntent] = useState<TIntentState>(null);
  const [approvalSeed, setApprovalSeed] = useState("");
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // store hooks
  const workspaceStore = useWorkspace();
  // derived values
  const workspaceId = workspaceStore.getWorkspaceBySlug(workspaceSlug)?.id as string;
  // BARSOUL B-7 草稿自动保存: 未发送内容按 issue 存 localStorage, 切卡/刷新/误关不丢, 回来接着写。
  const draftKey = `barsoul-comment-draft:${entityId}`;
  const [initialDraft] = useState(() => {
    try {
      const d = localStorage.getItem(draftKey);
      return d && !isCommentEmpty(d) ? d : "<p></p>";
    } catch {
      return "<p></p>";
    }
  });
  // form info
  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
    reset,
  } = useForm<Partial<TIssueComment>>({
    defaultValues: {
      comment_html: initialDraft,
    },
  });

  const onSubmit = async (formData: Partial<TIssueComment>) => {
    try {
      const comment = await activityOperations.createComment(formData);
      if (comment?.id) onSubmitCallback?.(comment.id);
      // B-7: 发送成功 → 清草稿(否则下次进来又恢复已发出的内容)
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* localStorage 不可用时忽略 */
      }
      if (uploadedAssetIds.length > 0) {
        if (projectId) {
          await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId.toString(), entityId, {
            asset_ids: uploadedAssetIds,
          });
        } else {
          await fileService.updateBulkWorkspaceAssetsUploadStatus(workspaceSlug, entityId, {
            asset_ids: uploadedAssetIds,
          });
        }
        setUploadedAssetIds([]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      reset({
        comment_html: "<p></p>",
      });
      editorRef.current?.clearEditor();
    }
  };

  const commentHTML = watch("comment_html");
  const isEmpty = isCommentEmpty(commentHTML ?? undefined);

  // ── BARSOUL: スラッシュ命令 ─────────────────────────────────────────────
  // 項目は i18n 済みでアプリ側が組む(`@plane/editor` は文言も業務も知らない)。
  // 渡した 2 項目だけがメニューに出る —— 見出し/表/画像はコメント欄に出さない。
  const commentCommands = useMemo(
    () =>
      buildCommentSlashOptions({
        approval: {
          title: t("comment_commands.approval_title"),
          description: t("comment_commands.approval_desc"),
          searchTerms: ["審査", "審査を依頼", "承認", "approval", "approve", "review", "审批", "shinsa", "sp"],
        },
        aichan: {
          title: t("comment_commands.aichan_title"),
          description: t("comment_commands.aichan_desc"),
          searchTerms: ["愛ちゃん", "爱酱", "ai", "aichan", "ask", "相談", "咨询", "chat"],
        },
      }),
    [t]
  );

  // 意図イベントはエディタ DOM から冒泡してくる。この受け皿が張られている
  // コンテナ = そのコメント欄の課題 —— DOM の入れ子がそのままスコープになるので
  // surfaceId もレジストリも要らない。
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onIntent = (e: Event) => {
      const detail = (e as CustomEvent<TCommentIntentDetail>).detail;
      if (!detail?.kind) return;
      // 審査モーダルは projectId 必須(ワークスペース直下のコメントでは出さない)。
      if (detail.kind === "approval" && !projectId) return;
      if (detail.kind === "approval") setApprovalSeed(detail.query);
      setIntent({ kind: detail.kind, query: detail.query });
    };
    node.addEventListener(COMMENT_INTENT_EVENT, onIntent);
    return () => node.removeEventListener(COMMENT_INTENT_EVENT, onIntent);
  }, [projectId]);

  // 私聊 → 公開の唯一の橋。**挿入するだけで投稿はしない** —— 送信を押すのは人間。
  const quoteToComment = useCallback((text: string) => {
    setIntent(null);
    const html = text
      .split("\n")
      .map((line) => `<p>${line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}</p>`)
      .join("");
    editorRef.current?.insertText(html, true);
    editorRef.current?.focus({ scrollIntoView: true });
  }, []);

  // 私聊の返答をそのまま審査の下敷きにする(私聊→公開の、もう一つの明示的な出口)。
  const escalateToApproval = useCallback(
    (text: string) => {
      if (!projectId) return;
      setApprovalSeed(text);
      setIntent({ kind: "approval", query: text });
    },
    [projectId]
  );

  const isChatOpen = intent?.kind === "aichan" && !!projectId;

  // BARSOUL(2026-06-15): 评论框 z-[20] 浮于上方评论头像(z-[4])之上, 否则工具栏 T 下拉
  // (向上弹)被头像盖住。★关键真凶: 桌面必须 sm:relative 而非 sm:static —— z-index 对
  // position:static 无效, sm:static 会让 z-[20] 在桌面(sm+)完全失效, 头像 z-4 反盖下拉。
  return (
    <div
      ref={rootRef}
      className={cn("sticky bottom-0 z-[20] bg-surface-1 sm:relative")}
      role="presentation"
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !isEmpty &&
          !isSubmitting &&
          editorRef.current?.isEditorReadyToDiscard()
        )
          handleSubmit(onSubmit)(e);
      }}
    >
      {/* BARSOUL B-2p v2: 発起審査ボタンは快捷动作行(IssueDetailWidgetActionButtons)へ移設 — 動作入口の統一(用户点名) */}

      {/* BARSOUL 私聊: コメント欄と **入れ替える**。入力欄が同時に二つ出ないので
          「今どこに打っているのか」を迷わない ＝ 誤爆投稿が構造的に起きない。 */}
      {isChatOpen && projectId && (
        <AichanChatPanel
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={entityId}
          seed={intent?.query}
          issueTitle={entityTitle}
          onClose={() => {
            setIntent(null);
            editorRef.current?.focus({ scrollIntoView: false });
          }}
          onQuote={quoteToComment}
          onEscalate={escalateToApproval}
        />
      )}

      {/* BARSOUL 審査: 既存モーダルをそのまま受託(認可・Temporal は一切変えない)。 */}
      {projectId && (
        <AichanApprovalButton
          variant="controlled"
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={entityId}
          initialInstruction={approvalSeed}
          open={intent?.kind === "approval"}
          onClose={() => {
            setIntent(null);
            setApprovalSeed("");
          }}
        />
      )}

      <div className={cn(isChatOpen && "hidden")}>
        <Controller
          name="access"
          control={control}
          render={({ field: { onChange: onAccessChange, value: accessValue } }) => (
            <Controller
              name="comment_html"
              control={control}
              render={({ field: { value, onChange } }) => (
                <LiteTextEditor
                  editable
                  workspaceId={workspaceId}
                  id={"add_comment_" + entityId}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  onEnterKeyPress={(e) => {
                    if (!isEmpty && !isSubmitting) {
                      handleSubmit(onSubmit)(e);
                    }
                  }}
                  ref={editorRef}
                  initialValue={value ?? "<p></p>"}
                  containerClassName="min-h-min"
                  commentCommands={commentCommands}
                  onChange={(comment_json, comment_html) => {
                    onChange(comment_html);
                    // B-7 草稿: 非空存, 空则清(避免残留空草稿)
                    try {
                      if (comment_html && !isCommentEmpty(comment_html)) localStorage.setItem(draftKey, comment_html);
                      else localStorage.removeItem(draftKey);
                    } catch {
                      /* localStorage 不可用时忽略 */
                    }
                  }}
                  accessSpecifier={accessValue ?? EIssueCommentAccessSpecifier.INTERNAL}
                  handleAccessChange={onAccessChange}
                  isSubmitting={isSubmitting}
                  uploadFile={async (blockId, file) => {
                    const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file);
                    setUploadedAssetIds((prev) => [...prev, asset_id]);
                    return asset_id;
                  }}
                  duplicateFile={async (assetId: string) => {
                    const { asset_id } = await activityOperations.duplicateCommentAsset(assetId);
                    setUploadedAssetIds((prev) => [...prev, asset_id]);
                    return asset_id;
                  }}
                  showToolbarInitially={showToolbarInitially}
                  parentClassName="p-2"
                  displayConfig={{
                    fontSize: "small-font",
                  }}
                />
              )}
            />
          )}
        />
      </div>
    </div>
  );
});
