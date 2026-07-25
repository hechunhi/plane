/**
 * BARSOUL: A2UI 原子摘要の Action ホワイトリスト。
 *
 * 「冻结薄缝」規律の延長:A2UI は *記述と描画* だけを担い、副作用は一切持たない。
 * サーフェスから飛んでくる action は **名前で照合** し、ここに登録済みの
 * ハンドラだけに委譲する。未登録名は握り潰す(黙って無視 + warn)——
 * 描画データ側に任意のアクション名を書かれても実行経路が生えない、が要点。
 *
 * ハンドラ自体は block.tsx が持つ **既存の** 経路をそのまま呼ぶ:
 *   - 進捗ページ  : 署名付き `/c/{ref}?as=view`（従来のフォールバック導線と同一 URL）
 *   - 決裁        : 既存の確認条 → 署名付き `/__act`（runAction）
 * つまり API・権限（サーバ側署名 + Plane セッション cookie）は一切迂回しない。
 */
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";

export type AtomicActionName = "openAtomicComponent" | "editAtomicComponent" | "changeStatus";

export const ATOMIC_ACTION_WHITELIST: readonly AtomicActionName[] = [
  "openAtomicComponent",
  "editAtomicComponent",
  "changeStatus",
] as const;

/**
 * 遷移先として許可する href だけを通す。
 *
 * spec の href は自社 Go サービス由来だが、A2UI 経路では「描画データが遷移を指示する」
 * 形になるため、ここで scheme を絞る（`javascript:` / `data:` を実行経路にしない）。
 * 相対 URL は現在のオリジン基準で解決してから判定する。
 * 従来の生 `<a href>` に無かった検査で、ここだけは意図的に従来より厳しい。
 */
export function safeExternalHref(raw: unknown): string | null {
  const href = typeof raw === "string" ? raw.trim() : "";
  if (!href) return null;
  try {
    const base = typeof window === "undefined" ? "https://localhost" : window.location.href;
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export type AtomicActionHandlers = {
  /**
   * 進捗ページ、もしくは spec の link/ref ブロックが指す先を開く。
   * context: { href?: string; label?: string } —— href 省略時は当該カードの進捗ページ。
   */
  openAtomicComponent: (ctx: Record<string, unknown>) => void;
  /** 詳細(md)の開閉。ローカル表示状態のみ。context: { open?: boolean } */
  editAtomicComponent: (ctx: Record<string, unknown>) => void;
  /** 決裁(承認/却下)。context: { href, label, act } → 既存の確認条へ。 */
  changeStatus: (ctx: Record<string, unknown>) => void;
};

function isWhitelisted(name: string): name is AtomicActionName {
  return (ATOMIC_ACTION_WHITELIST as readonly string[]).includes(name);
}

/**
 * MessageProcessor に渡す ActionListener を組み立てる。
 * 戻り値は同期関数——A2UI 側は await しないので、非同期処理はハンドラ内で完結させる。
 */
export function createAtomicActionDispatcher(handlers: AtomicActionHandlers) {
  return (action: A2uiClientAction): void => {
    const name = action?.name ?? "";
    if (!isWhitelisted(name)) {
      // eslint-disable-next-line no-console
      console.warn(`[barsoul-a2ui] action rejected (not whitelisted): ${String(name)}`);
      return;
    }
    const ctx = (action.context ?? {}) as Record<string, unknown>;
    handlers[name](ctx);
  };
}
