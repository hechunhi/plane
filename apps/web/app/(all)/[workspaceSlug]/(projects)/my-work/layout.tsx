/**
 * BARSOUL BS-216 Path A: 「我的工作」レイアウト。drafts/notifications と同じ
 * AppHeader + スクロール本体の枠。中身(page)は AIDigestView を ws スコープで描画。
 */
import { Outlet } from "react-router";
// components
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
// local imports
import { MyWorkHeader } from "./header";

export default function MyWorkLayout() {
  return (
    <>
      <AppHeader header={<MyWorkHeader />} />
      <ContentWrapper className="bg-surface-1">
        <Outlet />
      </ContentWrapper>
    </>
  );
}
