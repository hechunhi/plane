/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, type ReactNode } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation, type TTranslationStore } from "@plane/i18n";
// store hooks
// icons
import {
  TagIcon,
  CopyPlus,
  Calendar,
  Link2Icon,
  Users2Icon,
  ArchiveIcon,
  PaperclipIcon,
  TriangleIcon,
  LayoutGridIcon,
  SignalMediumIcon,
  MessageSquareIcon,
  UsersIcon,
} from "lucide-react";
import {
  BlockedIcon,
  BlockerIcon,
  CycleIcon,
  EpicIcon,
  IntakeIcon,
  ModuleIcon,
  RelatedIcon,
  WorkItemsIcon,
} from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { IIssueActivity } from "@plane/types";
import { renderFormattedDate, generateWorkItemLink, capitalizeFirstLetter } from "@plane/utils";
// helpers
import { useLabel } from "@/hooks/store/use-label";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types

type TT = TTranslationStore["t"];

export function IssueLink({ activity }: { activity: IIssueActivity }) {
  // router params
  const { workspaceSlug } = useParams();
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();

  const workItemLink = generateWorkItemLink({
    workspaceSlug: workspaceSlug?.toString() ?? activity.workspace_detail?.slug,
    projectId: activity?.project,
    issueId: activity?.issue,
    projectIdentifier: activity?.project_detail?.identifier,
    sequenceId: activity?.issue_detail?.sequence_id,
  });

  return (
    <Tooltip
      tooltipContent={activity?.issue_detail ? activity.issue_detail.name : t("issue_activity.work_item_deleted")}
      isMobile={isMobile}
    >
      {activity?.issue_detail ? (
        <a
          aria-disabled={activity.issue === null}
          href={workItemLink}
          target={activity.issue === null ? "_self" : "_blank"}
          rel={activity.issue === null ? "" : "noopener noreferrer"}
          className="inline items-center gap-1 font-medium text-primary hover:underline"
        >
          <span className="whitespace-nowrap">{`${activity.project_detail.identifier}-${activity.issue_detail.sequence_id}`}</span>{" "}
          <span className="font-regular break-all">{activity.issue_detail?.name}</span>
        </a>
      ) : (
        <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-primary">
          {t("issue_activity.a_work_item")}{" "}
        </span>
      )}
    </Tooltip>
  );
}

/**
 * BARSOUL(2026-07-26 hechun): 「どの課題の話か」を出す時の後置。
 *
 * 元は `to / from / of / for` を英語のまま挟み込んでいた。ja/zh では語順が違う
 * ので、訳語を差し替えても文にならない(「担当者を追加しました 何淳 を BS-386」)。
 * 中黒で **区切る** だけにすれば、どの言語でも壊れない — 連結子を訳す代わりに
 * 連結子を無くす。
 */
function IssueSuffix({ activity, showIssue }: { activity: IIssueActivity; showIssue: boolean }) {
  if (!showIssue) return null;
  return (
    <>
      <span className="text-tertiary"> · </span>
      <IssueLink activity={activity} />
    </>
  );
}

function UserLink({ activity }: { activity: IIssueActivity }) {
  // router params
  const { workspaceSlug } = useParams();

  return (
    <a
      href={`/${workspaceSlug ?? activity.workspace_detail?.slug}/profile/${
        activity.new_identifier ?? activity.old_identifier
      }`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center font-medium text-primary hover:underline"
    >
      {activity.new_value && activity.new_value !== "" ? activity.new_value : activity.old_value}
    </a>
  );
}

const LabelPill = observer(function LabelPill({ labelId, workspaceSlug }: { labelId: string; workspaceSlug: string }) {
  // store hooks
  const { workspaceLabels, fetchWorkspaceLabels } = useLabel();

  useEffect(() => {
    if (!workspaceLabels) fetchWorkspaceLabels(workspaceSlug);
  }, [fetchWorkspaceLabels, workspaceLabels, workspaceSlug]);

  return (
    <span
      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
      style={{
        backgroundColor: workspaceLabels?.find((l) => l.id === labelId)?.color ?? "#000000",
      }}
      aria-hidden="true"
    />
  );
});

/** intake の可否は verb に数字で載ってくる(-1 却下 / 0 スヌーズ / 1 承認 / 2 重複却下)。 */
const getInboxUserActivityMessage = (activity: IIssueActivity, t: TT) => {
  switch (activity.verb) {
    case "-1":
      return t("issue_activity.declined_from_intake");
    case "0":
      return t("issue_activity.snoozed_work_item");
    case "1":
      return t("issue_activity.accepted_from_intake");
    case "2":
      return t("issue_activity.declined_from_intake_duplicate");
    default:
      return t("issue_activity.updated_intake_status");
  }
};

/**
 * BARSOUL(2026-07-26 hechun): 個人概要 / 個人の活動 の文面を多言語化。
 *
 * 語彙は通知カードと同じ `issue_activity.*` を再利用する — 同じ出来事が
 * 「受信箱では日本語、個人概要では英語」になっていると、同じ事だと読めない。
 */
const activityDetails: {
  [key: string]: {
    message: (activity: IIssueActivity, showIssue: boolean, workspaceSlug: string, t: TT) => ReactNode;
    icon: ReactNode;
  };
} = {
  assignees: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t(activity.old_value === "" ? "issue_activity.added_a_new_assignee" : "issue_activity.removed_the_assignee")}
        <UserLink activity={activity} />
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <Users2Icon size={12} className="text-secondary" aria-hidden="true" />,
  },
  archived_at: {
    message: (activity, _showIssue, _workspaceSlug, t) => (
      <>
        {t(
          activity.new_value === "restore"
            ? "issue_activity.restored_the_work_item"
            : "issue_activity.archived_the_work_item"
        )}
        <IssueSuffix activity={activity} showIssue />
      </>
    ),
    icon: <ArchiveIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  attachment: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t(
          activity.verb === "created"
            ? "issue_activity.uploaded_a_new_attachment"
            : "issue_activity.removed_an_attachment"
        )}
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <PaperclipIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  description: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t("issue_activity.updated_the_description")}
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <MessageSquareIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  estimate_point: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t(
          !activity.new_value
            ? "issue_activity.removed_the_estimate_point"
            : "issue_activity.set_the_estimate_point_to"
        )}
        {activity.new_value && <span className="font-medium text-primary">{activity.new_value}</span>}
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <TriangleIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  issue: {
    message: (activity, _showIssue, _workspaceSlug, t) => (
      <>
        {t(
          activity.verb === "created"
            ? "issue_activity.created_work_item"
            : activity.verb === "converted"
              ? "issue_activity.converted_to_epic"
              : "issue_activity.deleted_work_item"
        )}
        <IssueLink activity={activity} />
      </>
    ),
    icon: <WorkItemsIcon width={12} height={12} className="text-secondary" aria-hidden="true" />,
  },
  epic: {
    message: (activity, _showIssue, _workspaceSlug, t) => (
      <>
        {t(
          activity.verb === "created"
            ? "issue_activity.created_work_item"
            : activity.verb === "converted"
              ? "issue_activity.converted_to_work_item"
              : "issue_activity.deleted_work_item"
        )}
        <IssueLink activity={activity} />
      </>
    ),
    icon: <EpicIcon width={12} height={12} className="text-secondary" aria-hidden="true" />,
  },
  labels: {
    message: (activity, showIssue, workspaceSlug, t) => {
      const added = activity.old_value === "";
      return (
        <span className="overflow-hidden">
          {t(added ? "issue_activity.added_a_new_label" : "issue_activity.removed_the_label")}
          <span className="inline-flex items-center gap-2 rounded-full border border-strong px-2 py-0.5 text-11">
            <LabelPill
              labelId={(added ? activity.new_identifier : activity.old_identifier) ?? ""}
              workspaceSlug={workspaceSlug}
            />
            <span className="line-clamp-1 flex-shrink font-medium break-all text-primary">
              {added ? activity.new_value : activity.old_value}
            </span>
          </span>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </span>
      );
    },
    icon: <TagIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  link: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      const created = activity.verb === "created";
      return (
        <>
          {t(
            created
              ? "issue_activity.added"
              : activity.verb === "updated"
                ? "issue_activity.updated_the"
                : "issue_activity.removed_this"
          )}
          <a
            href={`${created ? activity.new_value : activity.old_value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {t("issue_activity.link")}
          </a>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <Link2Icon size={12} className="text-secondary" aria-hidden="true" />,
  },
  cycles: {
    message: (activity, showIssue, workspaceSlug, t) => {
      const removed = activity.verb !== "created" && activity.verb !== "updated";
      const identifier = removed ? activity.old_identifier : activity.new_identifier;
      return (
        <>
          {t(
            activity.verb === "created"
              ? "issue_activity.added_work_item_to_cycle"
              : activity.verb === "updated"
                ? "issue_activity.set_the_cycle_to"
                : "issue_activity.removed_work_item_from_cycle"
          )}
          <a
            href={`/${workspaceSlug}/projects/${activity.project}/cycles/${identifier}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline items-center gap-1 font-medium text-primary hover:underline"
          >
            <span className="break-all">{removed ? activity.old_value : activity.new_value}</span>
          </a>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <CycleIcon height={12} width={12} className="text-secondary" aria-hidden="true" />,
  },
  modules: {
    message: (activity, showIssue, workspaceSlug, t) => {
      const removed = activity.verb !== "created" && activity.verb !== "updated";
      const identifier = removed ? activity.old_identifier : activity.new_identifier;
      return (
        <>
          {t(
            activity.verb === "created"
              ? "issue_activity.added_work_item_to_module"
              : activity.verb === "updated"
                ? "issue_activity.set_the_module_to"
                : "issue_activity.removed_work_item_from_module"
          )}
          <a
            href={`/${workspaceSlug}/projects/${activity.project}/modules/${identifier}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline items-center gap-1 font-medium text-primary hover:underline"
          >
            <span className="break-all">{removed ? activity.old_value : activity.new_value}</span>
          </a>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <ModuleIcon className="h-3 w-3 !text-secondary" aria-hidden="true" />,
  },
  name: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t("issue_activity.set_the_name_to")}
        <span className="font-medium break-all text-primary">{activity.new_value}</span>
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <MessageSquareIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  parent: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t(!activity.new_value ? "issue_activity.removed_the_parent" : "issue_activity.set_the_parent_to")}
        <span className="font-medium whitespace-nowrap text-primary">
          {activity.new_value || activity.old_value}
        </span>
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <UsersIcon className="h-3 w-3 !text-secondary" aria-hidden="true" />,
  },
  priority: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t("issue_activity.set_the_priority_to")}
        <span className="font-medium text-primary">
          {activity.new_value ? capitalizeFirstLetter(activity.new_value) : t("issue_activity.priority_none")}
        </span>
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <SignalMediumIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  relates_to: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      const added = activity.old_value === "";
      return (
        <>
          {t(added ? "issue_activity.marked_relates_to" : "issue_activity.removed_relates_to")}
          <span className="font-medium whitespace-nowrap text-primary">
            {added ? activity.new_value : activity.old_value}
          </span>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <RelatedIcon height="12" width="12" className="text-secondary" />,
  },
  blocking: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      const added = activity.old_value === "";
      return (
        <>
          {t(added ? "issue_activity.marked_blocking" : "issue_activity.removed_blocking")}
          <span className="font-medium whitespace-nowrap text-primary">
            {added ? activity.new_value : activity.old_value}
          </span>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <BlockerIcon height="12" width="12" className="text-secondary" />,
  },
  blocked_by: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      const added = activity.old_value === "";
      return (
        <>
          {t(added ? "issue_activity.marked_blocked_by" : "issue_activity.removed_blocked_by")}
          <span className="font-medium whitespace-nowrap text-primary">
            {added ? activity.new_value : activity.old_value}
          </span>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <BlockedIcon height="12" width="12" className="text-secondary" />,
  },
  duplicate: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      const added = activity.old_value === "";
      return (
        <>
          {t(added ? "issue_activity.marked_duplicate" : "issue_activity.removed_duplicate")}
          <span className="font-medium whitespace-nowrap text-primary">
            {added ? activity.new_value : activity.old_value}
          </span>
          <IssueSuffix activity={activity} showIssue={showIssue} />
        </>
      );
    },
    icon: <CopyPlus size={12} className="text-secondary" />,
  },
  state: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t("issue_activity.set_the_state_to")}
        <span className="font-medium break-all text-primary">{activity.new_value}</span>
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <LayoutGridIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  start_date: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t(!activity.new_value ? "issue_activity.removed_the_start_date" : "issue_activity.set_the_start_date_to")}
        {activity.new_value && (
          <span className="font-medium whitespace-nowrap text-primary">{renderFormattedDate(activity.new_value)}</span>
        )}
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <Calendar size={12} className="text-secondary" aria-hidden="true" />,
  },
  target_date: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {t(!activity.new_value ? "issue_activity.removed_the_due_date" : "issue_activity.set_the_due_date_to")}
        {activity.new_value && (
          <span className="font-medium whitespace-nowrap text-primary">{renderFormattedDate(activity.new_value)}</span>
        )}
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <Calendar size={12} className="text-secondary" aria-hidden="true" />,
  },
  inbox: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {getInboxUserActivityMessage(activity, t)}
        <IssueSuffix activity={activity} showIssue={showIssue} />
      </>
    ),
    icon: <IntakeIcon className="size-3 text-secondary" aria-hidden="true" />,
  },
};

export function ActivityIcon({ activity }: { activity: IIssueActivity }) {
  return <>{activityDetails[activity.field as keyof typeof activityDetails]?.icon}</>;
}

type ActivityMessageProps = {
  activity: IIssueActivity;
  showIssue?: boolean;
};

export function ActivityMessage({ activity, showIssue = false }: ActivityMessageProps) {
  // router params
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const activityField = activity.field ?? "issue";

  return (
    <>
      {activityDetails[activityField as keyof typeof activityDetails]?.message(
        activity,
        showIssue,
        workspaceSlug ? workspaceSlug.toString() : (activity.workspace_detail?.slug ?? ""),
        t
      )}
    </>
  );
}
