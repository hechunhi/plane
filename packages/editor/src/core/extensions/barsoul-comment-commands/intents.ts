/**
 * BARSOUL(2026-07-25 hechun): コメント欄スラッシュ命令 —— 意図の発火だけを担う薄い縫い目。
 *
 * 設計の要:
 *   `@plane/editor` は **アプリのコードを一切知らない**。命令が選ばれたら
 *   `editor.view.dom` 上に bubbling する CustomEvent を投げるだけ。
 *   受け手はコメント欄を含むコンテナが listener を張る —— DOM のバブリングが
 *   そのまま「どの課題のコメント欄か」のスコープになるので、surfaceId も
 *   レジストリも突合ロジックも要らない。
 *   既存の `barsoul:autoTranslate` / `barsoul:a2uiAtoms` と同じ流儀。
 */

/** コメント欄からアプリへ渡す意図イベント名。 */
export const COMMENT_INTENT_EVENT = "barsoul:comment-intent";

export type TCommentIntentKind =
  /** 審査を発起する(結果は公開 —— 審査コメント + 承認者への通知)。 */
  | "approval"
  /** 愛ちゃんと私聊する(結果は自分だけに見える —— 投稿するまで誰にも届かない)。 */
  | "aichan";

export type TCommentIntentDetail = {
  kind: TCommentIntentKind;
  /** スラッシュの後に打たれていた語。`/審査 請求書の件` のような一撃入力を拾う。 */
  query: string;
};

/**
 * 意図を発火する。listener が居なければ何も起きない(＝アプリ側未対応でも安全)。
 * SSR / DOM 無し環境では黙って no-op。
 */
export function dispatchCommentIntent(dom: unknown, detail: TCommentIntentDetail): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  const node = dom as { dispatchEvent?: (e: Event) => boolean } | null;
  if (!node || typeof node.dispatchEvent !== "function") return;
  node.dispatchEvent(
    new CustomEvent<TCommentIntentDetail>(COMMENT_INTENT_EVENT, {
      detail,
      bubbles: true,
      composed: true,
    })
  );
}
