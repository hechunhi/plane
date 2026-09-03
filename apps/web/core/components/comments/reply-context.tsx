/**
 * BARSOUL コメント返信 A 案 (hechun 2026-09-03)
 *
 * 「反馈が大量にぶら下がる課題で、**どの一件への返事なのか** が言えない」
 * —— BS-424 で出た実務の詰まり。解いた形は **引用式**:
 *
 *   ・返信も時系列の一番下に出る(活動フィードの順序を壊さない = 見落とさない)
 *   ・カード上端に「↩ 誰々: 引用一行」を出し、押すと元コメントへ跳んで光る
 *
 * 木構造(楼中楼)にしなかった理由は設計判断: 新しい返信が画面の **上** に
 * 出ることになり、一番読まれるべき新着が埋もれる。データ (IssueComment.parent)
 * は同じなので、後から折り畳み表示を足しても作り直しにならない。
 *
 * ここが持つのは「今どれに返そうとしているか」だけ。返信ボタン(各カード)と
 * 入力欄は兄弟同士で、間に共有 state が要る —— store に足すほどの寿命は無い
 * (画面を閉じれば消える一時的な意図) ので context に置く。
 */

import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

type TCommentReplyContext = {
  /** 返信先コメント id。undefined = 通常の投稿。 */
  replyToId: string | undefined;
  setReplyToId: (id: string | undefined) => void;
};

const CommentReplyContext = createContext<TCommentReplyContext>({
  replyToId: undefined,
  setReplyToId: () => {},
});

export const CommentReplyProvider = function CommentReplyProvider(props: { children: ReactNode }) {
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);
  const value = useMemo(() => ({ replyToId, setReplyToId }), [replyToId]);
  return <CommentReplyContext.Provider value={value}>{props.children}</CommentReplyContext.Provider>;
};

export const useCommentReply = () => useContext(CommentReplyContext);

/**
 * 引用行から元コメントへ跳ぶ。着地の見え方は通知センターから飛んできた時と
 * 同じ accent のソフトハイライト(activity-comment-root の演出と揃える —
 * 「跳んだ先はここ」の合図が画面内で二種類あると迷う)。
 *
 * アンカーは活動フィードの外枠 `ac-<id>`、無ければカード自身の `comment-<id>`。
 * フィルタで活動が畳まれている等で見つからない場合は false を返す。
 */
export const focusCommentInPlace = (commentId: string): boolean => {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(`ac-${commentId}`) ?? document.getElementById(`comment-${commentId}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const HL = "color-mix(in oklab, var(--bg-accent-primary) 14%, transparent)";
  el.style.borderRadius = "6px";
  el.style.transition = "background-color .7s ease";
  el.style.backgroundColor = HL;
  window.setTimeout(() => {
    el.style.transition = "background-color 1.4s ease";
    el.style.backgroundColor = "";
  }, 2200);
  return true;
};
