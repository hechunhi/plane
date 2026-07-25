/**
 * BARSOUL 2026-07-25 審査を一等市民に·受信箱: ワークスペース級「審査」ページ。
 * 待我处理 / 我发起 / 全部 の 3 タブで、自分が関与する審査を一望し、裁決待ちは
 * その場で承認/却下する。issue 紐付き審査の集約先であり、独立審査の落脚点でもある。
 */
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { ApprovalInboxRoot } from "@/components/approvals";
import { PageHead } from "@/components/core/page-title";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { Route } from "./+types/page";

function ApprovalsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { currentWorkspace } = useWorkspace();
  // derived values
  const pageTitle = currentWorkspace?.name
    ? `${currentWorkspace.name} · ${t("sidebar.approvals")}`
    : t("sidebar.approvals");

  return (
    <>
      <PageHead title={pageTitle} />
      <ApprovalInboxRoot workspaceSlug={workspaceSlug} />
    </>
  );
}

export default observer(ApprovalsPage);
