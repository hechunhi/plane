/**
 * BARSOUL: 卡片未読通知バッジ（红点/红数字）。
 * 課題カード上で未読更新を直接可視化（以前は右上の通知中心でしか分から
 * ず見逃しが多発）。判定ロジックは通知中心と完全に同一：未読(read_at空)
 * かつ 未アーカイブ かつ 未スヌーズ。1 件＝赤ドット、2 件以上＝赤数字。
 * データは通知 store を共有（バッジ初回 mount でワークスペース単位 1 回
 * だけ通知を先読み、追加 API なし）。
 */
import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";

type TIssueUnreadBadgeProps = {
  issueId: string | undefined;
  className?: string;
};

export const IssueUnreadBadge = observer(function IssueUnreadBadge(props: TIssueUnreadBadgeProps) {
  const { issueId, className } = props;
  const { workspaceSlug } = useParams();
  const { unreadCountByIssueId, ensureBadgeNotifications } = useWorkspaceNotifications();

  useEffect(() => {
    if (workspaceSlug) ensureBadgeNotifications(workspaceSlug.toString());
  }, [workspaceSlug, ensureBadgeNotifications]);

  const count = issueId ? unreadCountByIssueId(issueId) : 0;
  if (!count) return null;

  const isDot = count === 1;
  return (
    <Tooltip tooltipContent={`${count} 条未读更新 / ${count} 件の未読更新`} isMobile={false}>
      <span
        aria-label={`${count} unread updates`}
        className={cn(
          "ml-1 inline-flex flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white",
          isDot
            ? "h-1.5 w-1.5"
            : "h-4 min-w-[1rem] px-1 text-[10px] font-semibold leading-none",
          className
        )}
      >
        {isDot ? "" : count > 9 ? "9+" : count}
      </span>
    </Tooltip>
  );
});
