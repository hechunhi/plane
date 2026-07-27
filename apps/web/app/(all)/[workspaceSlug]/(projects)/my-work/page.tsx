/**
 * BARSOUL BS-216 Path A: 工作区级「我的工作」ページ。
 *
 * 2026-07-25 産品決定で **通知センターの流用** に置き換えた:
 * 全域 DIS 作业台(AIDigestView)は通知センターと重なる二重実装だったため、
 * 表示の骨格は通知カードへ寄せ、DIS/承認/担当は「レンズ」として上に足す
 * (MyWorkRoot を参照)。AIDigestView 自体はプロジェクト内で現役なので残す。
 *
 * peek / DIS 行動ダイアログ / hover ポップオーバは看板と同じグローバル層を同梱
 * (カード自身の project へルーティング済 → 跨项目でも催促/改担当/開くが正しく動く)。
 */
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { MyWorkRoot } from "@/components/my-work/root";
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
      {/* 通知センターと同じ流し + 「私は何をすればいい?」に答えるレンズ */}
      <MyWorkRoot workspaceSlug={workspaceSlug} />
      {/* カードを開く / 催促・改担当 / hover 現況——看板と同じグローバル層 */}
      <IssuePeekOverview />
      <GlobalAICurrentStatePopover />
      <GlobalDISActionDialogs />
    </>
  );
}

export default observer(MyWorkPage);
