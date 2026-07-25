/**
 * BARSOUL(2026-07-25 hechun): コメント欄スラッシュ命令の項目定義。
 *
 * 文言はアプリ側から受け取る(エディタ package に i18n 基盤が無いため)。
 * ここが持つのは **アイコンと発火** だけ —— 業務は一切知らない。
 */
import { Sparkles, Stamp } from "lucide-react";
// extensions
import type { TSlashCommandAdditionalOption } from "@/extensions/slash-commands/root";
// local
import { dispatchCommentIntent } from "./intents";
import type { TCommentIntentKind } from "./intents";

export type TCommentCommandLabel = {
  title: string;
  description: string;
  /** すべて小文字で。日本語/中国語/英語のどれで打っても当たるように複数入れる。 */
  searchTerms: string[];
};

export type TCommentCommandLabels = Record<TCommentIntentKind, TCommentCommandLabel>;

/** `/審査 請求書の件` のように後続語を打った場合、それを初期入力として持ち回る。 */
const queryAfterSlash = (text: string): string => {
  const at = text.lastIndexOf("/");
  return at === -1 ? "" : text.slice(at + 1).trim();
};

export const buildCommentSlashOptions = (labels: TCommentCommandLabels): TSlashCommandAdditionalOption[] => {
  const make = (kind: TCommentIntentKind, icon: React.ReactNode): TSlashCommandAdditionalOption => ({
    commandKey: kind === "approval" ? "barsoul-approval" : "barsoul-aichan",
    key: `barsoul-${kind}`,
    title: labels[kind].title,
    description: labels[kind].description,
    searchTerms: labels[kind].searchTerms,
    icon,
    section: "general",
    // このセクションには本命令しか入らない(allowedCommandKeys で絞る)ので
    // pushAfter は当たらない → 末尾追加になる。順序は配列順がそのまま効く。
    pushAfter: "text",
    command: ({ editor, range }) => {
      const typed = queryAfterSlash(editor.state.doc.textBetween(range.from, range.to, "\n", "\n"));
      // 命令そのものは本文に残さない。「/」から選択位置までを消してから発火する。
      editor.chain().focus().deleteRange(range).run();
      dispatchCommentIntent(editor.view.dom, { kind, query: typed });
    },
  });

  return [make("approval", <Stamp className="size-3.5" />), make("aichan", <Sparkles className="size-3.5" />)];
};
