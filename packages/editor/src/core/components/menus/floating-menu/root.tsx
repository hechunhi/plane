/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { FloatingPortal } from "@floating-ui/react";
import type { UseInteractionsReturn, UseFloatingReturn } from "@floating-ui/react";

type Props = {
  children: React.ReactNode;
  classNames?: {
    buttonContainer?: string;
    button?: string;
  };
  getFloatingProps: UseInteractionsReturn["getFloatingProps"];
  getReferenceProps: UseInteractionsReturn["getReferenceProps"];
  menuButton: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  options: UseFloatingReturn;
};

export function FloatingMenuRoot(props: Props) {
  const { children, classNames, getFloatingProps, getReferenceProps, menuButton, onClick, options } = props;
  // derived values
  const { refs, floatingStyles, context } = options;

  return (
    <>
      <div className={classNames?.buttonContainer}>
        <button
          ref={refs.setReference}
          {...getReferenceProps()}
          type="button"
          className={classNames?.button}
          onClick={(e) => {
            context.onOpenChange(!context.open);
            onClick?.(e);
          }}
        >
          {menuButton}
        </button>
      </div>
      {context.open && (
        <FloatingPortal>
          {/* BARSOUL B-14: 撤掉 FloatingOverlay backdrop — 它全屏挂 body 拦截"点回编辑框"
              的点击 → target 落在 body 遮罩 → peek 误判面板外而关闭(且 data-prevent 在
              FloatingOverlay 上 forward 不稳, 间歇失效)。useDismiss(见 use-floating-menu)
              独立检测 outside press 关浮层, 不依赖 backdrop; 删之浮层仍能点外部关闭, 仅失
              lockScroll(小下拉无影响)。无遮罩 → 点编辑框 target=编辑器(面板 DOM 内)→ peek 不关。 */}
          <div
            ref={refs.setFloating}
            {...getFloatingProps()}
            // BARSOUL B-12: 此浮层经 FloatingPortal 挂到 body(在 issue 详情面板 DOM 外),
            // 点击它会被 peek 的 outside-click 当成"点击面板外"而关闭面板 → 标记豁免
            // (peek 检测器用 closest("[data-prevent-outside-click]"))。一处覆盖所有用
            // FloatingMenuRoot 的 bubble menu selector(颜色/节点/链接/对齐)。
            data-prevent-outside-click="true"
            style={{
              ...floatingStyles,
              zIndex: 100,
            }}
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
