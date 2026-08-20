/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { ChevronRight } from "lucide-react";
// plane imports
import { EDraftIssuePaginationType } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// hooks
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
// local imports
import { WorkspaceDraftEmptyState } from "./empty-state";
import { WorkspaceDraftIssuesLoader } from "./loader";
import { WorkspaceDraftQuickAdd } from "./quick-add";
import { TodoListProvider } from "./todo/context";
import { TodoKeymapHint } from "./todo/keymap-hint";
import { TodoList } from "./todo/list";

type TWorkspaceDraftIssuesRoot = {
  workspaceSlug: string;
};

export const WorkspaceDraftIssuesRoot = observer(function WorkspaceDraftIssuesRoot(props: TWorkspaceDraftIssuesRoot) {
  const { workspaceSlug } = props;
  // states
  const [isCompletedOpen, setIsCompletedOpen] = useState(false);
  // plane hooks
  const { t } = useTranslation();
  // hooks
  const {
    loader,
    paginationInfo,
    fetchIssues,
    issueIds,
    completedIssueIds,
    completedLoader,
    completedFetched,
    fetchCompletedIssues,
  } = useWorkspaceDraftIssues();

  //swr hook for fetching issue properties
  useWorkspaceIssueProperties(workspaceSlug);

  // fetching issues
  const { isLoading } = useSWR(
    workspaceSlug ? `WORKSPACE_DRAFT_ISSUES_${workspaceSlug}` : null,
    workspaceSlug ? async () => await fetchIssues(workspaceSlug, "init-loader") : null,
    { revalidateOnFocus: false, revalidateIfStale: false }
  );

  // handle nest issues
  const handleNextIssues = async () => {
    if (!paginationInfo?.next_page_results) return;
    await fetchIssues(workspaceSlug, "pagination", EDraftIssuePaginationType.NEXT);
  };

  /**
   * BARSOUL 2026-08: 引き出しは **開いた時に初めて** 取りに行く。
   * 済んだものは普段見ないので、初回表示のコストに乗せる理由が無い。
   */
  const handleToggleCompleted = async () => {
    const next = !isCompletedOpen;
    setIsCompletedOpen(next);
    if (next && !completedFetched) await fetchCompletedIssues(workspaceSlug);
  };

  return (
    <TodoListProvider>
      {/* 画面いっぱいの縦並びにしておく。こうしないと、行が少ない日に
          鍵の一覧が一覧の直下で宙に浮いて、説明書きが本体に見える。 */}
      <div className="relative flex min-h-full flex-col">
        {/* BARSOUL 2026-08: 一行追加は常に最上段。空でも出す —— 空の時こそ
            「ここに書けばいい」が分からないと、この画面は永久に空のままになる。 */}
        <WorkspaceDraftQuickAdd workspaceSlug={workspaceSlug} />

        {isLoading ? (
          <WorkspaceDraftIssuesLoader items={14} />
        ) : issueIds.length <= 0 ? (
          <WorkspaceDraftEmptyState />
        ) : (
          <TodoList workspaceSlug={workspaceSlug} issueIds={issueIds} />
        )}

        {paginationInfo?.next_page_results && (
          <Fragment>
            {loader === "pagination" && issueIds.length >= 0 ? (
              <WorkspaceDraftIssuesLoader items={1} />
            ) : (
              <button
                type="button"
                className={cn(
                  "h-11 w-full border-b border-subtle bg-surface-1 p-3 pl-6 text-left text-13 font-medium transition-all",
                  "cursor-pointer text-accent-primary underline-offset-2 hover:text-accent-secondary hover:underline"
                )}
                onClick={handleNextIssues}
              >
                {t("workspace_draft_issues.todo.load_more")}
              </button>
            )}
          </Fragment>
        )}

        {/* 済んだ ToDo の引き出し。チェックした物が「消えた」ではなく
            「畳まれた」ことが見えていないと、人はチェックを押さなくなる。 */}
        <button
          type="button"
          onClick={handleToggleCompleted}
          aria-expanded={isCompletedOpen}
          className="flex w-full items-center gap-1.5 border-b border-subtle px-4 py-2.5 text-13 text-tertiary transition-colors hover:text-secondary md:px-6"
        >
          <ChevronRight className={cn("size-4 transition-transform", isCompletedOpen && "rotate-90")} />
          <span>{t("workspace_draft_issues.todo.completed")}</span>
          {completedFetched && <span className="text-tertiary">{completedIssueIds.length}</span>}
        </button>

        {isCompletedOpen &&
          (completedLoader === "init-loader" ? (
            <WorkspaceDraftIssuesLoader items={3} />
          ) : completedIssueIds.length === 0 ? (
            <div className="px-4 py-3 text-13 text-tertiary md:px-6">
              {t("workspace_draft_issues.todo.no_completed")}
            </div>
          ) : (
            <TodoList workspaceSlug={workspaceSlug} issueIds={completedIssueIds} isInCompletedDrawer />
          ))}

        {/* キーボードの手引き。使える鍵は、見えていない限り無いのと同じ。 */}
        <TodoKeymapHint isVisible={issueIds.length > 0} />
      </div>
    </TodoListProvider>
  );
});
