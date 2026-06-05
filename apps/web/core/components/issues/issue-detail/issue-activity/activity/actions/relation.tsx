/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import { useTranslation } from "@plane/i18n";
import type { TIssueActivity } from "@plane/types";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// Plane-web
import { useTimeLineRelationOptions } from "@/plane-web/components/relations";
import type { TIssueRelationTypes } from "@/plane-web/types";
//
import { IssueActivityBlockComponent } from "./";

type TIssueRelationActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueRelationActivity = observer(function IssueRelationActivity(props: TIssueRelationActivity) {
  const { activityId, ends } = props;
  // hooks
  const { t } = useTranslation();
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  const getRelationActivityContent = (a: TIssueActivity | undefined): string | undefined => {
    if (!a) return;
    switch (a.field) {
      case "blocking":
        return a.old_value === ""
          ? t("issue_activity.marked_blocking")
          : t("issue_activity.removed_blocking");
      case "blocked_by":
        return a.old_value === ""
          ? t("issue_activity.marked_blocked_by")
          : t("issue_activity.removed_blocked_by");
      case "duplicate":
        return a.old_value === ""
          ? t("issue_activity.marked_duplicate")
          : t("issue_activity.removed_duplicate");
      case "relates_to":
        return a.old_value === ""
          ? t("issue_activity.marked_relates_to")
          : t("issue_activity.removed_relates_to");
    }
    return;
  };
  const activityContent = getRelationActivityContent(activity);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={activity.field ? ISSUE_RELATION_OPTIONS[activity.field as TIssueRelationTypes]?.icon(14) : <></>}
      activityId={activityId}
      ends={ends}
    >
      {activityContent}
      {activity.old_value === "" ? (
        <span className="font-medium text-primary">{activity.new_value}.</span>
      ) : (
        <span className="font-medium text-primary">{activity.old_value}.</span>
      )}
    </IssueActivityBlockComponent>
  );
});
