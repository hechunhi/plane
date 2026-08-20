/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type React from "react";
import { useState } from "react";
import { observer } from "mobx-react";
import { Plus } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import { cn } from "@plane/utils";
// hooks
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
// local imports
import { PASTE_LIMIT, splitPastedLines } from "./todo/paste";

type Props = {
  workspaceSlug: string;
};


/**
 * BARSOUL 2026-08 — 個人 ToDo の一行追加。
 *
 * 下書き作成はこれまで **フル Issue モーダル** しか入口が無かった。
 * 「起票する」にはそれで良いが、「思い出したことを書き留める」には重すぎて、
 * 結局ここには何も溜まらなかった。だから：打つ → Enter → 終わり。
 * プロジェクトも州も担当も **後から** 付ける(行き先未定でも保存できる)。
 */
export const WorkspaceDraftQuickAdd = observer(function WorkspaceDraftQuickAdd(props: Props) {
  const { workspaceSlug } = props;
  // states
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // hooks
  const { t } = useTranslation();
  const { createIssue } = useWorkspaceDraftIssues();

  /**
   * 貼り付けが複数行なら、行の数だけ ToDo を作る。
   *
   * ここは「メモ帳やチャットから持ってくる」入口。1 行ずつ手で写させると、
   * 10 行ある時点でこの画面は使われなくなる。行頭の "- " や "1. " は
   * 貼り元の飾りで、やることの名前では無いので落とす。
   */
  const handlePaste = async (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n")) return;

    const names = splitPastedLines(text);
    if (names.length === 0) return;

    event.preventDefault();
    if (isSubmitting) return;

    const kept = names.slice(0, PASTE_LIMIT);
    setIsSubmitting(true);
    try {
      // 新しい行は先頭に積まれるので、**後ろの行から** 作る。
      // そうしないと貼り元と上下が逆さまになる。
      for (const name of [...kept].reverse()) await createIssue(workspaceSlug, { name });
      setValue("");
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

  const handleSubmit = async () => {
    const name = value.trim();
    if (!name || isSubmitting) return;
    // 先に入力欄を空にする。連続で打ち込めることが「書き留める道具」の条件。
    setValue("");
    setIsSubmitting(true);
    try {
      await createIssue(workspaceSlug, { name });
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

  return (
    <div className="sticky top-0 z-[2] border-b border-subtle bg-surface-1">
      <div className="flex items-center gap-2 px-4 py-2 md:px-6">
        <Plus className={cn("size-4 flex-shrink-0 text-tertiary", isSubmitting && "opacity-50")} />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 変換中の Enter は確定であって送信ではない。ここを見ないと
            // 日本語も中国語も、打ち終わる前に半端な行が飛んでいく。
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          onPaste={handlePaste}
          placeholder={t("workspace_draft_issues.todo.quick_add_placeholder")}
          aria-label={t("workspace_draft_issues.todo.quick_add_placeholder")}
          className="h-8 w-full bg-transparent text-13 text-primary outline-none placeholder:text-placeholder"
        />
      </div>
    </div>
  );
});
