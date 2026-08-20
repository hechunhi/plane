/**
 * BARSOUL 2026-08 — 行と行のあいだに開く「次の 1 行」。
 *
 * Enter を押した瞬間に空の行をサーバへ作らない。空の行が残ると、リストは
 * すぐに幽霊で埋まる。ここは **まだ存在しない行** で、文字が入って Enter が
 * 押された時にだけ実体になる。作った直後は自分の下にまた開く ——
 * 打つ → Enter → 打つ、が止まらないのがこの画面の速さの正体。
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import { cn } from "@plane/utils";
// hooks
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
// local imports
import { TodoTextarea } from "./auto-textarea";
import { useTodoList } from "./context";
import { orderAfter } from "./order";
import { PASTE_LIMIT, splitPastedLines } from "./paste";

type Props = {
  workspaceSlug: string;
  /** null = トップレベル。 */
  parentId: string | null;
  afterId: string | undefined;
};

export const TodoComposer = observer(function TodoComposer(props: Props) {
  const { workspaceSlug, parentId, afterId } = props;
  const { t } = useTranslation();
  const { createIssue, createSubIssue, getIssueById, getSubIssueIds, issueIds } = useWorkspaceDraftIssues();
  const { openComposer, closeComposer, focusRow } = useTodoList();
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [parentId, afterId]);

  const handleSubmit = async () => {
    const name = value.trim();
    if (!name) {
      // 空のまま Enter = 「もう足さない」の合図。閉じて元の行へ戻す。
      closeComposer();
      if (afterId) focusRow(afterId);
      return;
    }
    if (isSubmitting) return;
    setValue("");
    setIsSubmitting(true);
    try {
      const siblingIds = parentId ? getSubIssueIds(parentId) : issueIds;
      const todoOrder = orderAfter(siblingIds, afterId, (issueId) => getIssueById(issueId)?.todo_order);
      const created = parentId
        ? await createSubIssue(workspaceSlug, parentId, name, todoOrder)
        : await createIssue(workspaceSlug, { name, todo_order: todoOrder });
      // 作った行の下にもう一度開く。連打で下へ伸びていく。
      openComposer({ parentId, afterId: created?.id ?? afterId });
    } catch {
      setValue(name);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("workspace_draft_issues.todo.create_failed"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** 複数行を貼ったら、その場から下へ順番に生やす。貼った順のまま残るように 1 件ずつ繋ぐ。 */
  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    const names = splitPastedLines(text);
    if (names.length === 0) return;

    event.preventDefault();
    if (isSubmitting) return;

    const kept = names.slice(0, PASTE_LIMIT);
    setValue("");
    setIsSubmitting(true);
    let cursor = afterId;
    try {
      for (const name of kept) {
        const siblingIds = parentId ? getSubIssueIds(parentId) : issueIds;
        const todoOrder = orderAfter(siblingIds, cursor, (issueId) => getIssueById(issueId)?.todo_order);
        const created = parentId
          ? await createSubIssue(workspaceSlug, parentId, name, todoOrder)
          : await createIssue(workspaceSlug, { name, todo_order: todoOrder });
        cursor = created?.id ?? cursor;
      }
      // 貼り終わった末尾の下でまた待つ。続きを打てる。
      openComposer({ parentId, afterId: cursor });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("workspace_draft_issues.todo.pasted", { count: kept.length }),
        message:
          names.length > kept.length
            ? t("workspace_draft_issues.todo.paste_limited", { count: names.length - kept.length })
            : undefined,
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("workspace_draft_issues.todo.create_failed"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b border-subtle-1 bg-layer-1/40 py-2 pr-4 md:pr-6",
        parentId ? "pl-12 md:pl-14" : "pl-4 md:pl-6"
      )}
    >
      {/* 丸は置くが押せない。まだ「済にできる物」ではないから。 */}
      <span className="mt-0.5 size-5 flex-shrink-0 rounded-full border border-dashed border-strong" aria-hidden />
      <TodoTextarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void handleSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeComposer();
            if (afterId) focusRow(afterId);
          }
        }}
        onPaste={handlePaste}
        onBlur={() => {
          // 触っていない欄が開きっぱなしだと、次のクリックを黙って食う。
          if (!value.trim()) closeComposer();
        }}
        placeholder={t(
          parentId ? "workspace_draft_issues.todo.sub_task_placeholder" : "workspace_draft_issues.todo.new_placeholder"
        )}
        aria-label={t(
          parentId ? "workspace_draft_issues.todo.sub_task_placeholder" : "workspace_draft_issues.todo.new_placeholder"
        )}
        className="mt-0.5 text-13 text-primary placeholder:text-placeholder"
      />
    </div>
  );
});
