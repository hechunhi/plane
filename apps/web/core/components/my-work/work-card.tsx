/**
 * BARSOUL「我的工作」— 流の 1 行 (hechun 2026-07-25)
 *
 * 通知センターのカードと **同じ骨格** を持つ表示専用の器。
 *   左 48px の丸 / 主行 / 副行(BS-123 + 題名) / 脚注(時効染色) / hover 行操作
 * 通知(NotificationItem)は notification store に直結していて課題行を描けないので、
 * ここだけを presentational に抜き出す。**見た目の正本はここ 1 箇所** —
 * 「我的工作」が通知センターと別物に見えたら、それは二重実装に戻ったということ。
 */
import type { ReactNode } from "react";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
import { NotificationTimeFooter } from "@/components/workspace-notifications/sidebar/notification-card/time-footer";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** 左の丸の中身。lucide のみ(絵文字禁令)。 */
  icon: ReactNode;
  /** 丸の地色。既定は通知カードと同じ layer-1。 */
  iconClassName?: string;
  /** 主行 = 「何が起きたか / 何を求められているか」。 */
  title: ReactNode;
  /** 副行 = BS-123 + 課題名。通知カードと同じ位置に置く。 */
  subtitle?: ReactNode;
  /** 副行の右端。相対時刻や期限など。 */
  meta?: ReactNode;
  /** hover で出す行操作。クリックは行本体に伝播させない。 */
  actions?: ReactNode;
  /** 未読/未処理の左ドット + 淡い地色。 */
  unread?: boolean;
  active?: boolean;
  onClick?: () => void;
};

export function WorkCard(props: Props) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    icon,
    iconClassName,
    title,
    subtitle,
    meta,
    actions,
    unread,
    active,
    onClick,
  } = props;

  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 overflow-hidden border-b border-subtle py-4 transition-all",
        active && "bg-layer-1/30",
        unread && "bg-accent-primary/5"
      )}
      onClick={onClick}
    >
      {unread && (
        <div className="absolute top-[50%] left-2 z-[2] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}

      <div className="relative z-[1] flex w-full gap-2">
        <div
          className={cn(
            "relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1",
            iconClassName
          )}
        >
          {icon}
        </div>

        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium break-all whitespace-normal text-primary">
              {title}
            </div>
            {/* 行操作は hover まで隠す — 静止画面に押せる物を並べない。 */}
            {actions ? (
              // 行操作を押した時にカード自身の onClick（peek を開く）を発火させない
              // だけの入れ物。押せるのは中の actions で、この div は装飾扱い。
              <div
                role="presentation"
                className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                {actions}
              </div>
            ) : null}
          </div>

          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal">{subtitle}</div>
            {meta ? <div className="flex-shrink-0 text-tertiary">{meta}</div> : null}
          </div>

          {/* 逾期/停滞/球が相手 の脚注。通知カードと同じ派生・同じ失敗安全。 */}
          <NotificationTimeFooter workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} />
        </div>
      </div>
    </Row>
  );
}
