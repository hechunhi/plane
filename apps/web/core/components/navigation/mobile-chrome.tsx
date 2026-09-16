/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import type { ReactNode, RefCallback } from "react";
import { useLocation } from "react-router";
// plane imports
import { cn } from "@plane/utils";

/**
 * BARSOUL 2026-09 — スマホ限定「X アプリ式」クローム自動格納。
 *
 * 本文を下へ読み進める(=スクロールダウン)と、上部のヘッダー列(グローバル /
 * プロジェクトタブ / ページ見出し)と下部タブバーを画面外へ畳み、少しでも
 * 上へ戻すと即座に出す。390px では上だけで約 130px、下 56px を食っていたので、
 * 読んでいる最中は本文に全画面を渡す。
 *
 * 仕組み(CSS は globals.css の `.mobile-chrome` ブロック):
 *  - `<html data-mobile-chrome="hidden|visible">` を唯一の状態源にする。
 *  - 各クローム要素は `.mobile-chrome[data-edge=top|bottom]` を名乗り、自分の高さを
 *    `--mc-h` に書く(ResizeObserver)。hidden のときは負マージンで親の
 *    overflow-hidden の外へ滑り出る。position は変えないので本文の高さ計算や
 *    ポータル済みメニューには一切影響しない。
 *  - スクロール検知は document の capture フェーズ 1 本。Plane は本文ごとに
 *    別のスクロール要素を持つ(issue 詳細 / 一覧 / ページ)ので、対象を決め打ちせず
 *    「画面の半分以上を占める縦スクロール要素」だけを見る。
 *
 * ジッタ対策:クロームを畳むとスクロール要素が伸びて max が減り、末尾付近では
 * scrollTop がクランプされて逆向きのイベントが飛ぶ。状態を変えた直後の
 * 遷移時間ぶんは無視し、さらにスクロール余地が小さい要素は対象外にする。
 */

const MOBILE_QUERY = "(max-width: 767px)";
/** これだけ下へ動いたら畳む(指のブレで畳まない) */
const HIDE_AFTER_PX = 14;
/** これだけ上へ動いたら出す(出す方は敏感に) */
const SHOW_AFTER_PX = 6;
/** 先頭付近では常に出す */
const TOP_ZONE_PX = 40;
/** これ未満しかスクロールできない要素は対象外(畳んだ分でクランプが起きるため) */
const MIN_SCROLL_RANGE_PX = 320;
/** 状態変更後、遷移中のイベントを捨てる時間(CSS の transition と揃える) */
const SETTLE_MS = 300;

type MobileChromeState = "visible" | "hidden";

const writeState = (state: MobileChromeState | null) => {
  if (state === null) delete document.documentElement.dataset.mobileChrome;
  else document.documentElement.dataset.mobileChrome = state;
};

/** ワークスペース直下で 1 回だけマウントする(WorkspaceContentWrapper)。 */
export function useMobileChromeAutoHide() {
  const { pathname } = useLocation();

  // ルートが変わったら必ず見える状態から始める(新しい画面の見出しを隠さない)
  useEffect(() => {
    writeState("visible");
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const lastTop = new WeakMap<Element, number>();
    let state: MobileChromeState = "visible";
    let acc = 0;
    let settleUntil = 0;

    const apply = (next: MobileChromeState) => {
      if (next === state) return;
      state = next;
      acc = 0;
      settleUntil = performance.now() + SETTLE_MS;
      writeState(next);
    };

    const onScroll = (event: Event) => {
      if (!mq.matches) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const { scrollTop, scrollHeight, clientHeight } = target;
      const max = scrollHeight - clientHeight;
      if (max < MIN_SCROLL_RANGE_PX || clientHeight < window.innerHeight * 0.5) return;

      const prev = lastTop.get(target);
      lastTop.set(target, scrollTop);
      if (prev === undefined) return;
      // iOS のラバーバンド / 遷移中のクランプは無視
      if (scrollTop < 0 || scrollTop > max) return;
      if (performance.now() < settleUntil) return;

      if (scrollTop <= TOP_ZONE_PX) {
        apply("visible");
        return;
      }
      const delta = scrollTop - prev;
      if (delta === 0) return;
      if (delta > 0 !== acc > 0) acc = 0;
      acc += delta;
      if (acc >= HIDE_AFTER_PX) apply("hidden");
      else if (acc <= -SHOW_AFTER_PX) apply("visible");
    };

    // 画面幅がデスクトップに戻ったら必ず見せる
    const onMediaChange = () => {
      if (!mq.matches) apply("visible");
    };

    document.addEventListener("scroll", onScroll, true);
    mq.addEventListener("change", onMediaChange);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      mq.removeEventListener("change", onMediaChange);
      writeState(null);
    };
  }, []);
}

const HEIGHT_VAR = "--mc-h";

/**
 * クローム要素に付ける ref。自分の高さを `--mc-h` に書き続ける。
 * `className` に MOBILE_CHROME_CLASS、`data-edge` に top|bottom を併せて付けること。
 * 要素は条件付きで後から現れることがある(TABBED 行は設定の読込後に出る)ので、
 * useRef ではなく state に持ち、ノードが差し替わるたびに observer を張り直す。
 */
export function useMobileChromeRef<T extends HTMLElement>(): RefCallback<T> {
  const [node, setNode] = useState<T | null>(null);
  useEffect(() => {
    if (!node) return;
    const write = () => node.style.setProperty(HEIGHT_VAR, `${node.offsetHeight}px`);
    write();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.style.removeProperty(HEIGHT_VAR);
    };
  }, [node]);
  return setNode;
}

export const MOBILE_CHROME_CLASS = "mobile-chrome";

/**
 * 既存要素にクラスを足せない(root が flex で中身が多い)場合の薄い外枠。
 * md 以上では `display: contents` で存在を消し、デスクトップのレイアウトは
 * 1 ピクセルも変えない。
 */
export function MobileChrome({
  edge,
  className,
  children,
}: {
  edge: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  const ref = useMobileChromeRef<HTMLDivElement>();
  return (
    <div ref={ref} data-edge={edge} className={cn(MOBILE_CHROME_CLASS, "shrink-0 md:contents", className)}>
      {children}
    </div>
  );
}
