/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
// plane imports
import { useTranslation, type TTranslationStore } from "@plane/i18n";
import type { TNotification } from "@plane/types";
import {
  convertMinutesToHoursMinutesString,
  renderFormattedDate,
  replaceUnderscoreIfSnakeCase,
  sanitizeCommentForNotification,
  stripAndTruncateHTML,
} from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
import {
  ADDITIONAL_NOTIFICATION_CONTENT_MAP,
  renderAdditionalValue,
  shouldShowConnector,
} from "@/plane-web/components/workspace-notifications/notification-card/content";
// BARSOUL: 提醒/定期 通知专属文案(无 issue_activity, 走自有渲染)
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { translatePriority } from "@/lib/priority-label";
import { useUser } from "@/hooks/store/user";

// Types
export type TNotificationFieldData = {
  field: string | undefined;
  newValue: string | undefined;
  oldValue: string | undefined;
  verb: string | undefined;
};

export type TNotificationContentDetails = {
  action?: ReactNode;
  value?: ReactNode;
  showConnector?: boolean;
};

/**
 * BARSOUL(2026-07-26 hechun): 通知カードの文面を多言語化。
 *
 * 語彙は **課題詳細の活動欄と同じ `issue_activity.*` を再利用** する。
 * 同じ出来事(担当者を追加した / 状態を変えた)を通知と活動欄で別の言い回しに
 * すると、JP-CN 混成のチームでは「別の何かが起きた」と読まれる。
 *
 * 各キーは「動作句 + 末尾スペース」で、後ろに値が来る前提で全ロケール分
 * 揃っている(ja/zh は語順もそれで自然になるよう既に訳し分けてある)ので、
 * ここでは action に句、value に値を渡すだけで良い — 連結子 `to` を英語で
 * 挟み込む必要も無くなるため、原則 showConnector は false にする。
 */
type TT = TTranslationStore["t"];

export type TNotificationContentHandler = (
  data: TNotificationFieldData,
  ctx: { t: TT; renderCommentBox?: boolean }
) => TNotificationContentDetails | null;

export type TNotificationContentMap = {
  [key: string]: TNotificationContentHandler;
};

// Base notification content map for core fields
export const BASE_NOTIFICATION_CONTENT_MAP: TNotificationContentMap = {
  duplicate: ({ verb, newValue, oldValue }, { t }) => ({
    action: t(verb === "created" ? "issue_activity.marked_duplicate" : "issue_activity.removed_duplicate"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  assignees: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.added_a_new_assignee" : "issue_activity.removed_the_assignee"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  start_date: ({ newValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.set_the_start_date_to" : "issue_activity.removed_the_start_date"),
    value: renderFormattedDate(newValue),
    showConnector: false,
  }),
  target_date: ({ newValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.set_the_due_date_to" : "issue_activity.removed_the_due_date"),
    value: renderFormattedDate(newValue),
    showConnector: false,
  }),
  labels: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.added_a_new_label" : "issue_activity.removed_the_label"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  parent: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.set_the_parent_to" : "issue_activity.removed_the_parent"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  relates_to: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.marked_relates_to" : "issue_activity.removed_relates_to"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  blocking: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.marked_blocking" : "issue_activity.removed_blocking"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  blocked_by: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.marked_blocked_by" : "issue_activity.removed_blocked_by"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  state: ({ newValue }, { t }) => ({
    action: t("issue_activity.set_the_state_to"),
    value: newValue,
    showConnector: false,
  }),
  priority: ({ newValue }, { t }) => ({
    action: t("issue_activity.set_the_priority_to"),
    /* 優先度は DB の生値（urgent/high/medium/low）で来る。値も訳さないと
       「将优先级设置为 medium」のように文だけ中文で値が英語になる。 */
    value: translatePriority(newValue, t),
    showConnector: false,
  }),
  name: ({ newValue }, { t }) => ({
    action: t("issue_activity.set_the_name_to"),
    value: newValue,
    showConnector: false,
  }),
  cycles: ({ newValue, oldValue }, { t }) => ({
    action: t(
      newValue !== "" ? "issue_activity.added_work_item_to_cycle" : "issue_activity.removed_work_item_from_cycle"
    ),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  modules: ({ newValue, oldValue }, { t }) => ({
    action: t(
      newValue !== "" ? "issue_activity.added_work_item_to_module" : "issue_activity.removed_work_item_from_module"
    ),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  link: ({ verb, newValue, oldValue }, { t }) => ({
    action:
      t(
        verb === "created"
          ? "issue_activity.added"
          : verb === "updated"
            ? "issue_activity.updated_the"
            : "issue_activity.removed_this"
      ) + t("issue_activity.link"),
    value: newValue !== "" ? newValue : oldValue,
    showConnector: false,
  }),
  estimate_point: ({ newValue }, { t }) => ({
    action: t(
      newValue !== "" ? "issue_activity.set_the_estimate_point_to" : "issue_activity.removed_the_estimate_point"
    ),
    value: newValue,
    showConnector: false,
  }),
  comment: ({ newValue }, { t, renderCommentBox }) => ({
    action: t("issue_activity.commented"),
    value: renderCommentBox ? null : sanitizeCommentForNotification(newValue),
    showConnector: false,
  }),
  archived_at: ({ newValue }, { t }) => ({
    action: t(
      newValue === "restore" ? "issue_activity.restored_the_work_item" : "issue_activity.archived_the_work_item"
    ),
    value: null,
    showConnector: false,
  }),
  None: (_data, { t }) => ({
    action: null,
    value: t("issue_activity.assigned_the_work_item_to_you"),
    showConnector: false,
  }),
  attachment: ({ verb }, { t }) => ({
    action: t(
      verb === "created" ? "issue_activity.uploaded_a_new_attachment" : "issue_activity.removed_an_attachment"
    ),
    value: null,
    showConnector: false,
  }),
  description: ({ newValue }, { t }) => ({
    action: t("issue_activity.updated_the_description"),
    value: stripAndTruncateHTML(newValue || "", 55),
    showConnector: false,
  }),
  estimate_time: ({ newValue, oldValue }, { t }) => ({
    action: t(newValue !== "" ? "issue_activity.set_the_estimate_time_to" : "issue_activity.removed_the_estimate_time"),
    value:
      newValue !== ""
        ? convertMinutesToHoursMinutesString(Number(newValue))
        : convertMinutesToHoursMinutesString(Number(oldValue)),
    showConnector: false,
  }),
};

// Helper to get content details from maps
const getNotificationContentDetails = (
  fieldData: TNotificationFieldData,
  ctx: { t: TT; renderCommentBox?: boolean }
): TNotificationContentDetails | null => {
  const { field } = fieldData;
  if (!field) return null;

  // Check base map first
  const baseHandler = BASE_NOTIFICATION_CONTENT_MAP[field];
  if (baseHandler) return baseHandler(fieldData, ctx);

  // Check additional map from plane-web (EE extensions)
  const additionalHandler = ADDITIONAL_NOTIFICATION_CONTENT_MAP[field];
  if (additionalHandler) {
    return additionalHandler(fieldData, ctx);
  }

  return null;
};

export function NotificationContent({
  notification,
  workspaceId,
  workspaceSlug,
  projectId,
  renderCommentBox = false,
}: {
  notification: TNotification;
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  renderCommentBox?: boolean;
}) {
  const zh = useZh();
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  // BARSOUL: 提醒/定期 = 显示型通知(无 issue_activity)。专属文案 + 备忘直接显示(价值在通知本身,不骗点进卡)。
  const ndata = notification.data as { kind?: string; reminder?: { note?: string; by_id?: string; by_name?: string } };
  if (ndata?.kind === "reminder") {
    const note = (ndata.reminder?.note || "").trim();
    const byId = ndata.reminder?.by_id || "";
    const byName = ndata.reminder?.by_name || "";
    const self = !!byId && !!currentUser?.id && byId === currentUser.id;
    const who = self
      ? zh
        ? "你设的"
        : "自分で設定"
      : byName
        ? `${byName}${zh ? " 给你的" : "より"}`
        : zh
          ? "到点了"
          : "時間です";
    return (
      <>
        <span style={{ color: "#5b3fce", fontWeight: 500 }}>{zh ? "提醒" : "リマインダー"}</span>
        <span className="text-tertiary"> · {who} </span>
        <span className="font-medium text-primary">{note || (zh ? "回来看看这张卡" : "そろそろ対応を")}</span>
      </>
    );
  }
  if (ndata?.kind === "deadline") {
    // BARSOUL 2026-08: 期限リマインド。前日 / 当日の 2 種類しか無い。
    const phase = (notification.data as { deadline?: { phase?: string } })?.deadline?.phase;
    const today = phase === "deadline_today";
    return (
      <>
        <span style={{ color: "#b45309", fontWeight: 500 }}>{zh ? "截止提醒" : "期限のお知らせ"}</span>
        <span className="text-tertiary">
          {" · "}
          {today ? (zh ? "今天到期" : "今日が期限です") : zh ? "明天到期" : "明日が期限です"}
        </span>
      </>
    );
  }
  if (ndata?.kind === "recurring") {
    return (
      <>
        <span style={{ color: "#5f6168", fontWeight: 500 }}>{zh ? "定期任务" : "定期タスク"}</span>
        <span className="text-tertiary"> · {zh ? "新一期已生成" : "新しい回が生成されました"}</span>
      </>
    );
  }
  const { data, triggered_by_details: triggeredBy } = notification;
  const notificationField = data?.issue_activity?.field;
  const newValue = data?.issue_activity?.new_value;
  const oldValue = data?.issue_activity?.old_value;
  const verb = data?.issue_activity?.verb;

  const fieldData: TNotificationFieldData = {
    field: notificationField,
    newValue,
    oldValue,
    verb,
  };

  const renderTriggerName = () => (
    <span className="font-medium text-primary">
      {triggeredBy?.is_bot ? triggeredBy.first_name : triggeredBy?.display_name}{" "}
    </span>
  );

  // Get content details from map
  const contentDetails = getNotificationContentDetails(fieldData, { t, renderCommentBox });

  // Render action - use map value if defined, otherwise fall through to default handler
  // Note: undefined = fall through to default, null = explicitly no action text
  const renderAction = (): ReactNode => {
    if (!notificationField) return "";
    // Check if action is explicitly defined in map (including null)
    if (contentDetails && "action" in contentDetails) return contentDetails.action;
    /* 未知のフィールド(EE 拡張・将来の追加)だけがここに落ちる。
       素の `${verb} ${field}` を出すと英語が混ざるので、動作句だけは訳し、
       フィールド名は生のまま添える — 訳が無い事を隠して誤訳するより良い。 */
    return `${t("issue_activity.updated_the")}${replaceUnderscoreIfSnakeCase(notificationField)}`;
  };

  // Render value - use map value if defined, otherwise fall through to default handler
  const renderValue = (): ReactNode => {
    // Check if value is explicitly defined in map
    if (contentDetails && "value" in contentDetails) return contentDetails.value;
    // Fallback to default value handler for fields not in map or without value defined
    return renderAdditionalValue(notificationField, newValue, oldValue);
  };

  // Determine if connector should be shown - prefer map value, fallback to function
  const showConnector =
    contentDetails?.showConnector !== undefined ? contentDetails.showConnector : shouldShowConnector(notificationField);

  return (
    <>
      {renderTriggerName()}
      <span className="text-tertiary">{renderAction()} </span>
      {verb !== "deleted" && (
        <>
          {showConnector && <span className="text-tertiary">{t("issue_activity.to")}</span>}
          <span className="font-medium text-primary">{renderValue()}</span>
          {notificationField === "comment" && renderCommentBox && (
            <div className="origin-left scale-75">
              <LiteTextEditor
                editable={false}
                id=""
                initialValue={newValue ?? ""}
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                displayConfig={{
                  fontSize: "small-font",
                }}
              />
            </div>
          )}
          {t("issue_activity.period")}
        </>
      )}
    </>
  );
}
