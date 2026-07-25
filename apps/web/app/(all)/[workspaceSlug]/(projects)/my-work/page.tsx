/**
 * BARSOUL BS-216 Path A: 工作区级「我的工作」ページ。
 * 成熟した DIS 作业台(AIDigestView)を **projectId 無し=workspace 全域** で載せる:
 *   在籍する全プロジェクトを横断し「需我処理 / 待機中 / 停滞 / 逾期 / 待審批」を一望。
 * peek / DIS 行動ダイアログ / hover ポップオーバは看板と同じグローバル層を同梱
 * (カード自身の project へルーティング済 → 跨项目でも催促/改担当/開くが正しく動く)。
 */
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { AIDigestView } from "@/components/issues/issue-layouts/kanban/ai-digest-view";
import { GlobalAICurrentStatePopover } from "@/components/issues/issue-layouts/kanban/ai-current-state-popover";
import { GlobalDISActionDialogs } from "@/components/issues/issue-layouts/kanban/ai-state-actions";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { Route } from "./+types/page";

function MyWorkPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { currentWorkspace } = useWorkspace();
  // derived values
  const pageTitle = currentWorkspace?.name
    ? `${currentWorkspace.name} · ${t("sidebar.my_work")}`
    : t("sidebar.my_work");

  return (
    <>
      <PageHead title={pageTitle} />
      {/* projectId を渡さない → AIDigestView は workspace 全域モード */}
      <AIDigestView workspaceSlug={workspaceSlug} />
      {/* カードを開く / 催促・改担当 / hover 現況——看板と同じグローバル層 */}
      <IssuePeekOverview />
      <GlobalAICurrentStatePopover />
      <GlobalDISActionDialogs />
    </>
  );
}

export default observer(MyWorkPage);
