/**
 * BARSOUL 2026-08 — 高さが中身に追従する 1 枚のテキスト欄。
 *
 * 題名にもメモにも同じものを使う。`<input>` ではなく textarea なのは、
 * 長い題名を折り返して **全部見せる** ため(切り詰めた題名は結局開き直す
 * ことになり、リストの速さが台無しになる)。
 *
 * 高さを毎回 auto に戻してから scrollHeight を測るのが要。戻さないと
 * 一度伸びた高さが縮まない。
 */
import React, { forwardRef, useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "@plane/utils";

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  value: string;
};

export const TodoTextarea = forwardRef<HTMLTextAreaElement, Props>(function TodoTextarea(props, forwardedRef) {
  const { value, className, ...rest } = props;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (element: HTMLTextAreaElement | null) => {
      innerRef.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    },
    [forwardedRef]
  );

  useLayoutEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={setRefs}
      rows={1}
      value={value}
      // resize-none / overflow-hidden: 高さは中身が決めるので、掴んで伸ばす
      // ハンドルもスクロール条も出さない(出ても中身は常に収まっている)。
      className={cn("w-full resize-none overflow-hidden bg-transparent outline-none", className)}
      {...rest}
    />
  );
});
