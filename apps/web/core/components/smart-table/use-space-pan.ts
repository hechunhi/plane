/**
 * BARSOUL: 空格+拖动 平移表格(Figma 手感)。
 * 按住 Space → 手型光标;按住拖动 = 平移 glide 内部滚动容器(.dvn-scroller)。
 * 守门: 焦点在 input/textarea/contenteditable(含 glide #portal 单元格编辑器)时不劫持,
 * 正常打空格不受影响;mousedown 用 capture 拦在 glide 之前,拖动不会触发范围选择。
 * 代价(已裁决): 键盘导航选中 checkbox 格后按 Space 切换的路径被 pan 占用 — 鼠标点击仍可切。
 */
import { useEffect, type RefObject } from "react";

export function useSpacePan(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let space = false;
    let panning = false;
    let sx = 0, sy = 0, sl = 0, st = 0;

    const scroller = () => ref.current?.querySelector<HTMLElement>(".dvn-scroller") ?? null;
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
    };
    const setCls = () => {
      const root = ref.current;
      if (!root) return;
      root.classList.toggle("smart-glide-pan", space && !panning);
      root.classList.toggle("smart-glide-panning", panning);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing()) return;
      e.preventDefault(); // 防页面滚动; 不 stopPropagation(不吞别人的监听)
      if (e.repeat || space) return;
      space = true;
      setCls();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      space = false;
      panning = false;
      setCls();
    };
    const onMouseDown = (e: MouseEvent) => {
      const root = ref.current;
      if (!space || e.button !== 0 || !root || !root.contains(e.target as Node)) return;
      const s = scroller();
      if (!s) return;
      panning = true;
      sx = e.clientX; sy = e.clientY; sl = s.scrollLeft; st = s.scrollTop;
      e.preventDefault();
      e.stopPropagation(); // capture: 拦在 glide 前, 拖动 ≠ 选格
      setCls();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!panning) return;
      const s = scroller();
      if (!s) return;
      s.scrollLeft = sl - (e.clientX - sx);
      s.scrollTop = st - (e.clientY - sy);
    };
    const onMouseUp = () => {
      if (!panning) return;
      panning = false;
      setCls();
    };
    const onBlur = () => {
      space = false;
      panning = false;
      setCls();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [ref]);
}
