/**
 * BARSOUL 週会放映幕 — レイアウト (hechun 2026-07-27)
 *
 * 会議室の 100 インチテレビに映すためだけのページ。既存の `/weekly` は
 * 壳のある家の中でカーテンを閉めている（マウント時に toggleSidebar(true)）が、
 * 放映幕は壳の無い家に住む。
 *
 * なので `[workspaceSlug]/layout.tsx` の中には入れない —— あれは
 * WorkspaceContentWrapper（上部ナビ + AppRail + 余白）を無条件に描くので、
 * 入れた時点で「壳なし」が破れる。ここで必要な二枚（ログイン状態と
 * workspace ストア）だけを自分で積む。
 *
 * GlobalModals も載せない: 大屏の受け入れ条件は「押せるものが画面に無い」。
 */
import { Outlet } from "react-router";
// layouts
import { WorkspaceAuthWrapper } from "@/layouts/auth-layout/workspace-wrapper";
// wrappers
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";

export default function WeeklyPresentLayout() {
  return (
    <AuthenticationWrapper>
      <WorkspaceAuthWrapper>
        <Outlet />
      </WorkspaceAuthWrapper>
    </AuthenticationWrapper>
  );
}
