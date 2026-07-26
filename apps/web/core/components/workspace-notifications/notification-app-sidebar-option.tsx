/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { getNumberCount } from "@plane/utils";
// components
import { CountChip } from "@/components/common/count-chip";
import { UnreadDot } from "@/components/notifications/issue-unread-badge";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";

type TNotificationAppSidebarOption = {
  workspaceSlug: string;
};

export const NotificationAppSidebarOption = observer(function NotificationAppSidebarOption(
  props: TNotificationAppSidebarOption
) {
  const { workspaceSlug } = props;
  // hooks
  const { unreadNotificationsCount, getUnreadNotificationsCount, ensureBadgeNotifications, actionRequiredUnreadCount } =
    useWorkspaceNotifications();

  // 権威 count エンドポイント（@mention 有無 = プレフィックス判定に使用 + リアクティブ錨）
  useSWR(
    workspaceSlug ? "WORKSPACE_UNREAD_NOTIFICATION_COUNT" : null,
    workspaceSlug ? () => getUnreadNotificationsCount(workspaceSlug) : null
  );

  // BARSOUL(feat/inbox-action-count): actionRequiredUnreadCount は store の通知一覧
  // （直近~300件）から算出するため、一覧が未読込だと 0 になる。サイドバーは常時
  // マウントされるので、ここで先読みを保証（_badgeWS ガードで冪等・多重mount安全）。
  useEffect(() => {
    if (workspaceSlug) ensureBadgeNotifications(workspaceSlug);
  }, [workspaceSlug, ensureBadgeNotifications]);

  // BARSOUL: バッジ = 「行動が要る」未読のみ（needs-attention / 提及 / 指派 / 審批）。
  // comment/update の知会は数えない ＝ 数字を「本当に自分が動く件数」に一致させる。
  const hasMention = unreadNotificationsCount.mention_unread_notifications_count > 0;

  // BARSOUL(2026-07-26): 「動かなくていいが未読はある」を落とさない。
  // 件数(琥珀)は行動が要る分だけ = 数字の意味を保つ。しかし数字が出ないと
  // 「新しい動きがある」事自体が入口から見えず、開くきっかけが無くなる。
  // → その場合は件数を出さず赤点だけ(サイドバーの項目赤点と同じ語彙:
  //    赤=新しい動き / 琥珀の数字=何件待っている)。
  if (actionRequiredUnreadCount <= 0) {
    if (unreadNotificationsCount.total_unread_notifications_count <= 0) return <></>;
    return (
      <div className="ml-auto flex items-center pr-0.5">
        <UnreadDot />
      </div>
    );
  }

  return (
    <div className="ml-auto">
      {/* BARSOUL(2026-07-07): 未読件数 = 行動信号 → 色彩語義に従い琥珀(warning)へ。
          共有 CountChip の既定は accent 青(=位置/選択)。ここだけ className で上書きし、
          他の CountChip 用途には影響させない。逐卡の赤 danger ドットとは役割分担
          (琥珀=「何件待っている」/ 赤=「このカードに新しい動き」)。 */}
      <CountChip
        count={`${hasMention ? `@ ` : ``}${getNumberCount(actionRequiredUnreadCount)}`}
        className="!bg-warning-subtle !text-warning-primary"
      />
    </div>
  );
});
