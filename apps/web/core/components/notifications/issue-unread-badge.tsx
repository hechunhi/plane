/**
 * BARSOUL: 卡片未読通知バッジ（红点/红数字）。
 * 課題カード上で未読更新を直接可視化（以前は右上の通知中心でしか分からず
 * 見逃し多発）。判定ロジックは通知中心と完全同一：未読(read_at空) かつ
 * 未アーカイブ かつ 未スヌーズ。1 件＝赤ドット、2 件以上＝赤数字。
 *
 * 重要: Plane の Tailwind はトークン化されており bg-red-500/text-white 等の
 * 既定パレットを生成しない（コードベースは bg-danger-primary 等のみ使用）。
 * → これら Tailwind 色クラスを当てても無スタイル＝白地カードで不可視。
 * 色/サイズは inline style で当てる（テーマ非依存・確実に見える）。
 * レイアウト系ユーティリティ(inline-flex 等)は既定生成されるので併用可。
 */
import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Tooltip } from "@plane/propel/tooltip";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";

type TIssueUnreadBadgeProps = {
  issueId: string | undefined;
};

const RED = "#ef4444"; // red-500（inline; テーマ非依存で確実に描画）

export const IssueUnreadBadge = observer(function IssueUnreadBadge(props: TIssueUnreadBadgeProps) {
  const { issueId } = props;
  const { workspaceSlug } = useParams();
  const { unreadCountByIssueId, ensureBadgeNotifications } = useWorkspaceNotifications();

  useEffect(() => {
    // 無条件で呼ぶ（slug は store 側で router からも兜底）。
    ensureBadgeNotifications((workspaceSlug || "").toString());
  }, [workspaceSlug, ensureBadgeNotifications]);

  const count = issueId ? unreadCountByIssueId(issueId) : 0;
  if (!count) return null;

  const isDot = count === 1;
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginLeft: 4,
    background: RED,
    color: "#fff",
    borderRadius: 9999,
    fontWeight: 700,
    lineHeight: 1,
    verticalAlign: "middle",
  };
  const style: React.CSSProperties = isDot
    ? { ...base, width: 7, height: 7 }
    : { ...base, height: 16, minWidth: 16, padding: "0 4px", fontSize: 10 };

  return (
    <Tooltip tooltipContent={`${count} 条未读更新 / ${count} 件の未読更新`} isMobile={false}>
      <span aria-label={`${count} unread updates`} style={style}>
        {isDot ? "" : count > 9 ? "9+" : count}
      </span>
    </Tooltip>
  );
});
