/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { mutate as globalMutate } from "swr";
import { XCircle, ArchiveRestoreIcon, Calendar, Clock, Moon, Repeat, Sunrise } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { LinkIcon, CopyIcon, NewTabIcon, EditIcon, ArchiveIcon, TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, TIssue } from "@plane/types";
import type { TContextMenuItem } from "@plane/ui";
import { copyUrlToClipboard, generateWorkItemLink } from "@plane/utils";
// types
import { createCopyMenuWithDuplication } from "@/plane-web/components/issues/issue-layouts/quick-action-dropdowns";
// BARSOUL フォローアップ・スヌーズ / 定期化(用户: 这些做进卡片右键菜单, 不进卡也能点; 删掉杵着的独立按钮)
import { recurringService, type TReminderInput } from "@/services/recurring.service";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";

// BARSOUL リマインダー快捷预设: 与详情页 ReminderActionButton(recurring-card.tsx)同源。
// 客户端只算"相对时刻 / 日历起点"; 服务端按 JST 权威落地。绝不写 SoR。
const _pad = (n: number) => String(n).padStart(2, "0");
const _ymd = (d: Date) => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
const _mkDay = (add: number): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + add);
  return d;
};
const _nextMon = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const a = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + a);
  return d;
};
// 我的常用(localStorage, 用户级 UI 偏好·非 SoR): 与 ReminderActionButton 共享 key, 只读复用。
const _REL_PRESET_KEY = "barsoul.reminder.relPresets";
function _loadRelPresets(): { mins: number; label: string }[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(_REL_PRESET_KEY) || "[]");
    return Array.isArray(v)
      ? v.filter((p) => p && typeof p.mins === "number" && p.mins > 0 && typeof p.label === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

// Generic helper function to handle optional function calls gracefully
// Overload for functions without parameters
export function handleOptionalAction(
  optionalFn: (() => void) | (() => Promise<void>) | undefined,
  actionName: string
): void;

// Overload for functions with one parameter
export function handleOptionalAction<T>(
  optionalFn: ((param: T) => void) | ((param: T) => Promise<void>) | undefined,
  actionName: string,
  param: T
): void;

// Implementation
export function handleOptionalAction<T>(
  optionalFn: (() => void) | (() => Promise<void>) | ((param: T) => void) | ((param: T) => Promise<void>) | undefined,
  actionName: string,
  param?: T
): void {
  if (optionalFn) {
    if (param !== undefined) {
      (optionalFn as (param: T) => void | Promise<void>)(param);
    } else {
      (optionalFn as () => void | Promise<void>)();
    }
  } else {
    setToast({
      type: TOAST_TYPE.ERROR,
      title: "Action not available",
      message: `${actionName} action is not implemented.`,
    });
  }
}

export interface MenuItemFactoryProps {
  issue: TIssue;
  workspaceSlug?: string;
  projectIdentifier?: string;
  activeLayout?: string;
  isEditingAllowed: boolean;
  isArchivingAllowed?: boolean;
  isDeletingAllowed: boolean;
  isRestoringAllowed?: boolean;
  isInArchivableGroup?: boolean;
  issueTypeDetail?: { is_active?: boolean };
  // Action handlers
  setIssueToEdit: (issue: TIssue | undefined) => void;
  setCreateUpdateIssueModal: (open: boolean) => void;
  setDeleteIssueModal: (open: boolean) => void;
  setArchiveIssueModal?: (open: boolean) => void;
  setDuplicateWorkItemModal?: (open: boolean) => void;
  handleRemoveFromView?: () => void;
  handleRestore?: () => Promise<void>;
  // External handlers
  handleDelete?: () => Promise<void>;
  handleUpdate?: (data: TIssue) => Promise<void>;
  handleArchive?: () => Promise<void>;
  // Context-specific data
  cycleId?: string;
  moduleId?: string;
  storeType?: EIssuesStoreType;
  // BARSOUL: 定期化モーダルを開く(各 quick-action 组件がローカルで editor を mount → ここはトリガーだけ)。未配線なら項目非表示。
  onRecurrize?: () => void;
}

// Common action handlers hook
export const useIssueActionHandlers = (props: MenuItemFactoryProps) => {
  const { issue, workspaceSlug, projectIdentifier, handleRestore } = props;

  const workItemLink = useMemo(
    () =>
      generateWorkItemLink({
        workspaceSlug,
        projectId: issue?.project_id,
        issueId: issue?.id,
        projectIdentifier,
        sequenceId: issue?.sequence_id,
      }),
    [workspaceSlug, projectIdentifier, issue]
  );

  const handleCopyIssueLink = () =>
    copyUrlToClipboard(workItemLink).then(() =>
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Link copied",
        message: "Work item link copied to clipboard",
      })
    );

  const handleOpenInNewTab = () => window.open(workItemLink, "_blank");

  const handleIssueRestore = async () => {
    if (!handleRestore) {
      handleOptionalAction(handleRestore, "Restore");
      return;
    }
    await handleRestore()
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Restore success",
          message: "Your work item can be found in project work items.",
        });
        return;
      })
      .catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: "Work item could not be restored. Please try again.",
        });
      });
  };

  return {
    workItemLink,
    handleCopyIssueLink,
    handleOpenInNewTab,
    handleIssueRestore,
  };
};

export const useMenuItemFactory = (props: MenuItemFactoryProps) => {
  const { t } = useTranslation();
  const zh = useZh(); // BARSOUL 双语菜单文案
  const actionHandlers = useIssueActionHandlers(props);

  const {
    issue,
    activeLayout = "",
    isEditingAllowed,
    isArchivingAllowed = false,
    isDeletingAllowed,
    isRestoringAllowed = false,
    isInArchivableGroup = false,
    issueTypeDetail,
    setIssueToEdit,
    setCreateUpdateIssueModal,
    setDeleteIssueModal,
    setArchiveIssueModal,
    setDuplicateWorkItemModal,
    handleRemoveFromView,
  } = props;

  const createEditMenuItem = (customEditAction?: () => void): TContextMenuItem => ({
    key: "edit",
    title: t("common.actions.edit"),
    icon: EditIcon,
    action:
      customEditAction ||
      (() => {
        setIssueToEdit(issue);
        setCreateUpdateIssueModal(true);
      }),
    shouldRender: isEditingAllowed,
  });

  const createCopyMenuItem = (workspaceSlug?: string): TContextMenuItem => {
    const baseItem = {
      key: "make-a-copy",
      title: t("common.actions.make_a_copy"),
      icon: CopyIcon,
      action: () => {
        setCreateUpdateIssueModal(true);
      },
      shouldRender: isEditingAllowed && (issueTypeDetail?.is_active ?? true),
    };

    return createCopyMenuWithDuplication({
      baseItem,
      activeLayout,
      setCreateUpdateIssueModal,
      setDuplicateWorkItemModal,
      workspaceSlug,
    });
  };

  const createOpenInNewTabMenuItem = (): TContextMenuItem => ({
    key: "open-in-new-tab",
    title: t("common.actions.open_in_new_tab"),
    icon: NewTabIcon,
    action: actionHandlers.handleOpenInNewTab,
  });

  const createCopyLinkMenuItem = (): TContextMenuItem => ({
    key: "copy-link",
    title: t("common.actions.copy_link"),
    icon: LinkIcon,
    action: actionHandlers.handleCopyIssueLink,
  });

  const createRemoveFromCycleMenuItem = (): TContextMenuItem => ({
    key: "remove-from-cycle",
    title: "Remove from cycle",
    icon: XCircle,
    action: () => handleOptionalAction(handleRemoveFromView, "Remove from cycle"),
    shouldRender: isEditingAllowed,
  });

  const createRemoveFromModuleMenuItem = (): TContextMenuItem => ({
    key: "remove-from-module",
    title: "Remove from module",
    icon: XCircle,
    action: () => handleOptionalAction(handleRemoveFromView, "Remove from module"),
    shouldRender: isEditingAllowed,
  });

  const createArchiveMenuItem = (): TContextMenuItem => ({
    key: "archive",
    title: t("common.actions.archive"),
    description: isInArchivableGroup ? undefined : t("issue.archive.description"),
    icon: ArchiveIcon,
    className: "items-start",
    iconClassName: "mt-1",
    action: () => handleOptionalAction(setArchiveIssueModal, "Archive", true),
    disabled: !isInArchivableGroup,
    shouldRender: isArchivingAllowed,
  });

  const createRestoreMenuItem = (): TContextMenuItem => ({
    key: "restore",
    title: "Restore",
    icon: ArchiveRestoreIcon,
    action: actionHandlers.handleIssueRestore,
    shouldRender: isRestoringAllowed,
  });

  const createDeleteMenuItem = (): TContextMenuItem => ({
    key: "delete",
    title: t("common.actions.delete"),
    icon: TrashIcon,
    action: () => {
      setDeleteIssueModal(true);
    },
    shouldRender: isDeletingAllowed,
  });

  // BARSOUL フォローアップ・スヌーズ: 右键「提醒我 ▸ 富预设」纯 API(无模态), hover 展开。设了卡片保留可见(紫条)。
  // 直接复用详情页 ReminderActionButton 的预设集 / 标签 / 图标(recurring-card.tsx)。
  const createSnoozeMenuItem = (): TContextMenuItem => {
    const ws = props.workspaceSlug;
    const pid = issue.project_id;
    // 右键快捷 = 不隐藏 + 一次 + 只我(无黑洞); 富配置走详情页「提醒」条的详细设置。
    const apply = async (body: TReminderInput) => {
      if (!ws || !pid) return;
      const r = await recurringService
        .setSnooze(ws, pid, issue.id, { ...body, hide: false, intensity: "once", audience: "self" })
        .catch(() => null);
      if (r?.set) {
        // 与详情页同源: 即时写入 SNOOZE SWR 缓存, 看板卡片紫色提醒态立刻反映, 无需刷新页面。
        void globalMutate(`SNOOZE:${issue.id}`, r, { revalidate: false });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: `${zh ? "已设提醒" : "リマインダー"} · ${r.at_jst ?? ""}`,
          message: zh ? "卡片保留可见" : "表示のまま",
        });
      } else {
        setToast({ type: TOAST_TYPE.ERROR, title: zh ? "设置失败" : "設定に失敗しました", message: "" });
      }
    };
    const rel = (mins: number) => apply({ at: new Date(Date.now() + mins * 60000).toISOString() });
    const day = (d: Date, time: string) => apply({ until: _ymd(d), time });
    // 段标题: disabled + customContent(键盘/点击均跳过, 仅作视觉分组)
    const hdr = (key: string, label: string): TContextMenuItem => ({
      key,
      title: label,
      action: () => {},
      disabled: true,
      customContent: (
        <span className="block w-full px-1 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
          {label}
        </span>
      ),
    });

    const showTonight = new Date().getHours() < 18; // 18 点后「今晚」无意义
    const customs = _loadRelPresets();
    const nested: TContextMenuItem[] = [
      hdr("snz-h-today", zh ? "今天处理" : "今日中"),
      { key: "snz-30", title: zh ? "30 分钟后" : "30分後", icon: Clock, action: () => void rel(30) },
      { key: "snz-60", title: zh ? "1 小时后 · 荐" : "1時間後 · 推奨", icon: Clock, action: () => void rel(60) },
      { key: "snz-120", title: zh ? "2 小时后" : "2時間後", icon: Clock, action: () => void rel(120) },
      { key: "snz-180", title: zh ? "3 小时后" : "3時間後", icon: Clock, action: () => void rel(180) },
      ...(customs.length
        ? [
            hdr("snz-h-fav", zh ? "我的常用" : "よく使う"),
            ...customs.map((p) => ({
              key: `snz-fav-${p.mins}`,
              title: p.label,
              icon: Clock,
              action: () => void rel(p.mins),
            })),
          ]
        : []),
      hdr("snz-h-after", zh ? "之后" : "その後"),
      ...(showTonight
        ? [
            {
              key: "snz-tonight",
              title: zh ? "今晚 18:00" : "今夜 18:00",
              icon: Moon,
              action: () => void day(_mkDay(0), "18:00"),
            },
          ]
        : []),
      { key: "snz-tmrw", title: zh ? "明天上午 09:00" : "明日 09:00", icon: Sunrise, action: () => void day(_mkDay(1), "09:00") },
      { key: "snz-day2", title: zh ? "后天 09:00" : "明後日 09:00", icon: Calendar, action: () => void day(_mkDay(2), "09:00") },
      { key: "snz-mon", title: zh ? "下周一 09:00" : "来週月 09:00", icon: Calendar, action: () => void day(_nextMon(), "09:00") },
    ];

    return {
      key: "barsoul-snooze",
      title: zh ? "提醒我" : "リマインド",
      icon: Clock,
      action: () => {},
      shouldRender: isEditingAllowed && !!ws && !!pid,
      nestedMenuItems: nested,
    };
  };

  // BARSOUL この作業を定期化: メニューからモーダルを開く(onRecurrize 配線済みの context のみ表示)。
  const createRecurrizeMenuItem = (): TContextMenuItem => ({
    key: "barsoul-recurrize",
    title: zh ? "设为定期" : "定期化",
    icon: Repeat,
    action: () => props.onRecurrize?.(),
    shouldRender: isEditingAllowed && !!props.onRecurrize,
  });

  return {
    ...actionHandlers,
    createEditMenuItem,
    createCopyMenuItem,
    createOpenInNewTabMenuItem,
    createCopyLinkMenuItem,
    createRemoveFromCycleMenuItem,
    createRemoveFromModuleMenuItem,
    createArchiveMenuItem,
    createRestoreMenuItem,
    createDeleteMenuItem,
    createSnoozeMenuItem,
    createRecurrizeMenuItem,
  };
};

// Predefined menu item sets for different contexts
export const useProjectIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createEditMenuItem(),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      // BARSOUL 2026-06-21: 右键「提醒我」回归(看板/列表) — hover 展开富预设(复用详情页 ReminderActionButton); 减少点击
      factory.createSnoozeMenuItem(),
      factory.createRecurrizeMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};

export const useWorkItemDetailMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createCopyMenuItem(props.workspaceSlug),
      factory.createOpenInNewTabMenuItem(),
      factory.createSnoozeMenuItem(),
      factory.createRecurrizeMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createRestoreMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory, props.workspaceSlug]
  );
};

export const useAllIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createEditMenuItem(),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createSnoozeMenuItem(),
      factory.createRecurrizeMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};

export const useCycleIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  const customEditAction = useCallback(() => {
    props.setIssueToEdit({
      ...props.issue,
      cycle_id: props.cycleId ?? null,
    });
    props.setCreateUpdateIssueModal(true);
  }, [props]);

  return useMemo(
    () => [
      factory.createEditMenuItem(customEditAction),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createSnoozeMenuItem(),
      factory.createRecurrizeMenuItem(),
      factory.createRemoveFromCycleMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory, customEditAction]
  );
};

export const useModuleIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  const customEditAction = useCallback(() => {
    props.setIssueToEdit({
      ...props.issue,
      module_ids: props.moduleId ? [props.moduleId] : [],
    });
    props.setCreateUpdateIssueModal(true);
  }, [props]);

  return useMemo(
    () => [
      factory.createEditMenuItem(customEditAction),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createSnoozeMenuItem(),
      factory.createRecurrizeMenuItem(),
      factory.createRemoveFromModuleMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory, customEditAction]
  );
};

export const useArchivedIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createRestoreMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};
