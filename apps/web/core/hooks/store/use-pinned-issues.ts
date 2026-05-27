/**
 * BARSOUL Pin/収藏 hook (IUTEYA-9).
 * 利用例:
 *   const { isPinned, togglePin } = usePinnedIssues();
 *   const pinned = isPinned(issue.id);
 *   <button onClick={() => togglePin(workspaceSlug, issue.id, issue.project_id)}>★</button>
 */
import { useContext } from "react";
import { StoreContext } from "@/lib/store-context";
import type { IPinnedIssuesStore } from "@/store/pinned-issues.store";

export const usePinnedIssues = (): IPinnedIssuesStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("usePinnedIssues must be used within StoreProvider");
  return context.pinnedIssues;
};
