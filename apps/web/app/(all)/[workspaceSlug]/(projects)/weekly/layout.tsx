/**
 * BARSOUL 週次ミーティング — レイアウト (hechun 2026-07-24)
 * my-work と同じ AppHeader + 本体の枠。本体側で独自にスクロールを持つので
 * ContentWrapper には余白を足さない。
 */
import { Outlet } from "react-router";
// components
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
// local imports
import { WeeklyHeader } from "./header";

export default function WeeklyLayout() {
  return (
    <>
      <AppHeader header={<WeeklyHeader />} />
      {/* 本文側で独自にスクロールを持つ(ツールバー固定 + 3 列)ので、外側のスクロールは殺す */}
      <ContentWrapper className="overflow-y-hidden bg-surface-1">
        <Outlet />
      </ContentWrapper>
    </>
  );
}
