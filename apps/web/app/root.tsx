/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState, type ReactNode } from "react";
import Script from "next/script";
import { Links, Meta, Outlet, Scripts } from "react-router";
import type { LinksFunction } from "react-router";
import { ThemeProvider, useTheme } from "next-themes";
// plane imports
import { SITE_DESCRIPTION } from "@plane/constants";
import { cn } from "@plane/utils";
// types
// assets
import favicon16 from "@/app/assets/favicon/favicon-16x16.png?url";
import favicon32 from "@/app/assets/favicon/favicon-32x32.png?url";
import faviconIco from "@/app/assets/favicon/favicon.ico?url";
import icon180 from "@/app/assets/icons/icon-180x180.png?url";
import icon512 from "@/app/assets/icons/icon-512x512.png?url";
import ogImage from "@/app/assets/og-image.png?url";
import globalStyles from "@/styles/globals.css?url";
import type { Route } from "./+types/root";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
// local
import { CustomErrorComponent } from "./error";
import { AppProvider } from "./provider";
// fonts
import "@fontsource-variable/inter";
import interVariableWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import "@fontsource/material-symbols-rounded";
import "@fontsource/ibm-plex-mono";

const APP_TITLE = "Plane | Simple, extensible, open-source project management tool.";

/**
 * BARSOUL 2026-08: ホーム画面に追加した時に出るアプリ名。
 * manifest.json の "name" と必ず同じ文字列にする(片方だけ変えると
 * iOS はホーム画面のラベルだけ古いままになる)。
 */
const PWA_APP_NAME = "BARSOUL Tasks";

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/png", sizes: "32x32", href: favicon32 },
  { rel: "icon", type: "image/png", sizes: "16x16", href: favicon16 },
  { rel: "shortcut icon", href: faviconIco },
  // BARSOUL 2026-08: manifest は 1 本だけ。以前は site.webmanifest.json と
  // manifest.json の 2 本を link していて、ブラウザは先に来た方(= 名前 "Plane"、
  // アイコンが 1 枚だけの site.webmanifest.json)を採用していた。
  // ホーム画面に追加した時のアプリ名が "Plane" になっていたのはこれが原因。
  { rel: "apple-touch-icon", href: icon512 },
  { rel: "apple-touch-icon", sizes: "180x180", href: icon180 },
  { rel: "apple-touch-icon", sizes: "512x512", href: icon512 },
  { rel: "manifest", href: "/manifest.json" },
  { rel: "stylesheet", href: globalStyles },
  {
    rel: "preload",
    href: interVariableWoff2,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const isSessionRecorderEnabled = parseInt(process.env.VITE_ENABLE_SESSION_RECORDER || "0");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* BARSOUL: Safari に requestIdleCallback が無いと fork の
            gantt-layout-loader が無防備に呼んで全画面クラッシュする。
            React ツリー内 (Layout の <head> 先頭) で描画することで
            prerender と client の DOM が一致し、document 全体を
            hydrate する React 18.3 でも #418/#423 を起こさない。
            これにより patches/index.html のバインドマウント
            (リビルド毎に asset hash 不一致で白画面) も不要になる。 */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html:
              '!function(){if(!("requestIdleCallback"in window)){window.requestIdleCallback=function(c){var s=Date.now();return setTimeout(function(){c({didTimeout:!1,timeRemaining:function(){return Math.max(0,50-(Date.now()-s))}})},1)};window.cancelIdleCallback=function(i){clearTimeout(i)}}}();',
          }}
        />
        <meta charSet="utf-8" />
        {/* BARSOUL 2026-08: iPhone の PWA 対応。
            - viewport-fit=cover: セーフエリアを自分で制御する宣言。これが無いと
              env(safe-area-inset-*) が常に 0 になり、下部タブをホームインジケータの
              上に逃がせない(= ラベルが切れる)。
            - maximum-scale / user-scalable は指定しない。ピンチ拡大は
              アクセシビリティ機能なので潰さない。
            - interactive-widget=resizes-content: ソフトキーボードが出た時に
              ビューポート自体を縮める(= 100dvh が追従する)。Android Chrome 向け。 */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        {/* BARSOUL 2026-08: ステータスバー/アドレスバーの色をテーマに追従させる。
            media 付きを 2 本置くのが仕様どおりの書き方で、ダークだけ黒くなる。 */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0d0d0d" />
        {/* Meta info for PWA */}
        <meta name="application-name" content={PWA_APP_NAME} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* black-translucent = ステータスバーの下まで web view が広がる。
            viewport-fit=cover + ルートの pt-[env(safe-area-inset-top)] と対で機能し、
            上端に灰色の帯が出ない。 */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={PWA_APP_NAME} />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
        <div id="context-menu-portal" />
        <div id="editor-portal" />
        <ThemeProvider themes={["light", "dark", "light-contrast", "dark-contrast", "custom"]} defaultTheme="system">
          {children}
        </ThemeProvider>
        {/* BARSOUL: glide-data-grid overlay editor 挂载点(写死找 #portal; 缺 → 智能表 text/date 等格子编辑器打不开)。
            data-prevent-outside-click: peek の mousedown 外点判定が浮層クリックを「面板外」と誤認して
            peek を閉じる(=編集不能に見える)のを防ぐ(Plane 既有約定, use-peek-overview-outside-click 参照)。
            style は glide 公式要件: fixed(0,0) 基準が無いと浮層が文書末尾へ流れ「見えないのに入力は届く」怪現象になる。 */}
        <div id="portal" data-prevent-outside-click style={{ position: "fixed", left: 0, top: 0, zIndex: 9999 }} />
        <Scripts />
        {!!isSessionRecorderEnabled && process.env.VITE_SESSION_RECORDER_KEY && (
          <Script id="clarity-tracking">
            {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];if(y){y.parentNode.insertBefore(t,y);}
          })(window, document, "clarity", "script", "${process.env.VITE_SESSION_RECORDER_KEY}");`}
          </Script>
        )}
      </body>
    </html>
  );
}

export const meta: Route.MetaFunction = () => [
  { title: APP_TITLE },
  { name: "description", content: SITE_DESCRIPTION },
  { property: "og:title", content: APP_TITLE },
  {
    property: "og:description",
    content: "Open-source project management tool to manage work items, cycles, and product roadmaps easily",
  },
  { property: "og:url", content: "https://app.plane.so/" },
  { property: "og:image", content: ogImage },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: "Plane - Modern project management" },
  {
    name: "keywords",
    content:
      "software development, plan, ship, software, accelerate, code management, release management, project management, work item tracking, agile, scrum, kanban, collaboration",
  },
  { name: "twitter:site", content: "@planepowers" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:image", content: ogImage },
  { name: "twitter:image:width", content: "1200" },
  { name: "twitter:image:height", content: "630" },
  { name: "twitter:image:alt", content: "Plane - Modern project management" },
];

// BARSOUL: SPA mode (react-router.config.ts → ssr: false). Plane prerenders
// an empty shell at build time; the client's first render builds the full
// component tree. Without a clientLoader, React Router would try to render
// the full <Root /> tree during hydration, causing #418 mismatch against the
// shell (the Suspense markers RR7 streams have no matching content).
//
// Adding a clientLoader that's hydrate-eligible makes React Router show
// <HydrateFallback /> during hydration (which matches the empty shell — just
// an empty <div /> on the server side), THEN swap to <Root /> after the
// loader resolves on the client. No mismatch, no recovery needed.
export async function clientLoader() {
  return null;
}
clientLoader.hydrate = true as const;

export default function Root() {
  return (
    <AppProvider>
      <div
        className={cn(
          // BARSOUL 2026-08: h-screen(=100vh) は iOS でビューポートより背が高くなる。
          // (Safari はツールバーぶんを含んだ「最大」の高さを 100vh として返し、
          //  standalone PWA でもホームインジケータ帯を含む。)
          // その結果アプリ最下段 = 下部タブバーが画面外にはみ出し、ラベルが
          // 半分に切れていた。100dvh は「今実際に見えている」高さなので切れない。
          // セーフエリアはここで一括して逃がす。上端は bg-canvas 帯になり、
          // 直下の TopNavigationRoot も bg-canvas なので継ぎ目は出ない。
          // 下端は下部タブバー側が自前で pb を持つのでここでは足さない
          // (二重に足すとタブが浮く)。
          "relative flex h-dvh w-full flex-col overflow-hidden bg-canvas",
          "pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
          "desktop-app-container"
        )}
      >
        <main className="relative h-full w-full overflow-hidden">
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

export function HydrateFallback() {
  const { resolvedTheme } = useTheme();
  // Client first paint MUST match the server's prerendered output (empty div).
  // `typeof window` flips between server/client at the same render call →
  // mismatch. Use the standard hydration-safe pattern: render empty on first
  // paint, swap to spinner via useEffect (post-hydration).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated || resolvedTheme === undefined) return <div />;

  return (
    <div className="relative flex h-dvh w-full items-center justify-center bg-canvas">
      <LogoSpinner />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <CustomErrorComponent error={error} />;
}
