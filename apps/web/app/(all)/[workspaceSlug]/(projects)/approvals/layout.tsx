/**
 * BARSOUL 2026-07-25 審査を一等市民に·受信箱: レイアウト。my-work/weekly と同じ
 * AppHeader + スクロール本体の枠。中身(page)は ApprovalInboxRoot を ws スコープで描画。
 */
import { Outlet } from "react-router";
// components
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
// local imports
import { ApprovalsHeader } from "./header";

export default function ApprovalsLayout() {
  return (
    <>
      <AppHeader header={<ApprovalsHeader />} />
      <ContentWrapper className="bg-surface-1">
        <Outlet />
      </ContentWrapper>
    </>
  );
}
