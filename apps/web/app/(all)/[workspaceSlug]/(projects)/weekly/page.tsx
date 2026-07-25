/**
 * BARSOUL 週次ミーティング — ページ (hechun 2026-07-24)
 * 出処クリックで peek を開くため、看板と同じグローバル層を同梱する。
 */
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { WeeklyRoot } from "@/components/weekly/weekly-root";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { Route } from "./+types/page";

function WeeklyPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} · ${t("sidebar.weekly")}` : t("sidebar.weekly");

  return (
    <>
      <PageHead title={pageTitle} />
      <WeeklyRoot workspaceSlug={workspaceSlug} />
      <IssuePeekOverview />
    </>
  );
}

export default observer(WeeklyPage);
