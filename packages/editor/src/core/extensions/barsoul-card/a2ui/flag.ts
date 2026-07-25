/**
 * BARSOUL: A2UI 原子摘要の Feature Flag。
 *
 * 既存の `barsoul.autoTranslate`（comments/card/display.tsx）と同じ規約:
 * localStorage キー + 同名コロンイベントで、同一タブ内の全ノードを同期する。
 * 既定 OFF —— フラグを立てた人だけが A2UI 経路に入る（それ以外は従来 UI）。
 */
export const A2UI_ATOMS_KEY = "barsoul.a2uiAtoms";
export const A2UI_ATOMS_EVENT = "barsoul:a2uiAtoms";

/** SSR / localStorage 不可（Safari プライベート等）でも絶対に投げない。 */
export function readA2uiAtomsFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(A2UI_ATOMS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setA2uiAtomsFlag(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(A2UI_ATOMS_KEY, on ? "1" : "0");
  } catch {
    /* 保存できなくてもイベントは飛ばす（当該タブ内は効く） */
  }
  window.dispatchEvent(new CustomEvent(A2UI_ATOMS_EVENT, { detail: on }));
}

/**
 * コンソールからの切替口を生やす（開発・検証用）。
 *
 * localStorage を直接書くだけだと `A2UI_ATOMS_EVENT` が飛ばず、開いている
 * カードが再描画されない（リロードが要る）。それが分かりにくいので、
 * 必ずイベントまで飛ばす入口を用意しておく:
 *   barsoulA2ui.on() / .off() / .status()
 * 何度呼んでも安全（既に生えていれば何もしない）。
 */
function installDevToggle(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.barsoulA2ui) return;
  w.barsoulA2ui = {
    on: () => (setA2uiAtomsFlag(true), "A2UI 原子描画: ON"),
    off: () => (setA2uiAtomsFlag(false), "A2UI 原子描画: OFF"),
    status: () => (readA2uiAtomsFlag() ? "ON" : "OFF"),
  };
}

/** 購読ヘルパ。React 非依存にして block.tsx 側の useSyncExternalStore に渡せる形。 */
export function subscribeA2uiAtomsFlag(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  installDevToggle();
  const onStorage = (e: StorageEvent) => {
    if (e.key === A2UI_ATOMS_KEY) cb();
  };
  window.addEventListener(A2UI_ATOMS_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(A2UI_ATOMS_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
