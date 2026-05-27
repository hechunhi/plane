/**
 * BARSOUL Pin/收藏 ボタン (IUTEYA-9, 2026-05-27).
 *
 * UX:
 *  - pinned: golden ★ 常時表示(一目で識別)
 *  - 未 pinned: subtle ☆ outline(hover でのみ可視, 未読カードの掃除感を保つ)
 *  - クリック → togglePin (optimistic)
 *  - エラー時 toast + revert
 */
import type { MouseEvent } from "react";
import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
import { usePinnedIssues } from "@/hooks/store/use-pinned-issues";

type Props = {
  issueId: string;
  projectId: string | null | undefined;
  /** "card" = kanban tile 用(常時表示 + hover で☆), "row" = list 行(同様だが小さめ) */
  variant?: "card" | "row";
};

export const PinButton = observer(function PinButton({ issueId, projectId, variant = "card" }: Props) {
  const { workspaceSlug } = useParams();
  const ws = (workspaceSlug || "").toString();
  const store = usePinnedIssues();
  const pinned = store.isPinned(issueId);
  const [busy, setBusy] = useState(false);

  if (!issueId || !projectId || !ws) return null;

  const onClick = async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await store.togglePin(ws, issueId, projectId);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: pinned ? "解除失敗 / 取消固定失败" : "ピン失敗 / 固定失败",
        message: "再試行してください / 请稍后再试",
      });
    } finally {
      setBusy(false);
    }
  };

  const sizePx = variant === "card" ? 14 : 12;

  return (
    <Tooltip
      tooltipContent={pinned ? "ピン解除 / 取消固定" : "ピン / 固定到顶部"}
      isMobile={false}
    >
      <button
        type="button"
        aria-label={pinned ? "unpin" : "pin"}
        aria-pressed={pinned}
        disabled={busy}
        onClick={onClick}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded transition-opacity",
          // 未 pin: 透過 → hover で出現 (clutter 防止). pin 済: 常時表示.
          // 親 group は kanban tile / list 行 で異なるので両方に対応.
          pinned
            ? "opacity-100"
            : "opacity-0 group-hover/kanban-block:opacity-60 group-hover/list-block:opacity-60 hover:!opacity-100",
          busy && "cursor-wait opacity-50"
        )}
        style={{ width: sizePx + 4, height: sizePx + 4 }}
      >
        {/* ★ filled (pinned) / ☆ outline (未 pin). svg で正確に. */}
        {pinned ? (
          <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="#eab308">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        ) : (
          <svg width={sizePx} height={sizePx} viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        )}
      </button>
    </Tooltip>
  );
});
