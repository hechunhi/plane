/**
 * BARSOUL 2026-08 — 鍵の一覧。画面の一番下に、小さく、常に。
 *
 * 覚えている人には要らない。要るのは「Tab で子にできる」を **まだ知らない**
 * 人で、その人は説明書を読みに行かない。だから画面の中に置く。
 * 触る端末では鍵が無いので出さない。
 */
import { useTranslation } from "@plane/i18n";

const KEYS: { combo: string; labelKey: string }[] = [
  { combo: "Enter", labelKey: "workspace_draft_issues.todo.keymap.new_row" },
  { combo: "Tab", labelKey: "workspace_draft_issues.todo.keymap.indent" },
  { combo: "⇧Tab", labelKey: "workspace_draft_issues.todo.keymap.outdent" },
  { combo: "⌘Enter", labelKey: "workspace_draft_issues.todo.keymap.toggle_done" },
  { combo: "⌥Enter", labelKey: "workspace_draft_issues.todo.keymap.memo" },
  { combo: "↑↓", labelKey: "workspace_draft_issues.todo.keymap.move_focus" },
  // 貼れば行になる、は誰も推測できない。ここに出しておかないと一生使われない。
  { combo: "⌘V", labelKey: "workspace_draft_issues.todo.keymap.paste_lines" },
];

export const TodoKeymapHint = function TodoKeymapHint({ isVisible }: { isVisible: boolean }) {
  const { t } = useTranslation();

  // 一行も無い画面に鍵の一覧だけ残ると、説明書きが本体に見える。
  if (!isVisible) return null;

  return (
    <div className="mt-auto hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-subtle px-6 py-3 text-11 text-placeholder md:flex">
      {KEYS.map(({ combo, labelKey }) => (
        <span key={combo} className="flex items-center gap-1.5">
          <kbd className="rounded border border-subtle-1 bg-layer-1 px-1.5 py-0.5 font-sans text-11 text-tertiary">
            {combo}
          </kbd>
          {t(labelKey)}
        </span>
      ))}
    </div>
  );
};
