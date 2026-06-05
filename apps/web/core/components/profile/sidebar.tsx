/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Disclosure, Transition } from "@headlessui/react";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { IconButton } from "@plane/propel/icon-button";
import { EditIcon, ChevronDownIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { IUserProfileProjectSegregation } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn, renderFormattedDate, getFileURL } from "@plane/utils";
// components
import { CoverImage } from "@/components/common/cover-image";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
// components
import { ProfileSidebarTime } from "./time";

type TProfileSidebar = {
  userProjectsData: IUserProfileProjectSegregation | undefined;
  className?: string;
};

export const ProfileSidebar = observer(function ProfileSidebar(props: TProfileSidebar) {
  const { userProjectsData, className = "" } = props;
  // refs
  const ref = useRef<HTMLDivElement>(null);
  // router
  const { userId } = useParams();
  // store hooks
  const { data: currentUser } = useUser();
  const { profileSidebarCollapsed, toggleProfileSidebar } = useAppTheme();
  const { getProjectById } = useProject();
  const { toggleProfileSettingsModal } = useCommandPalette();
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();
  // derived values
  const userData = userProjectsData?.user_data;

  useOutsideClickDetector(ref, () => {
    if (profileSidebarCollapsed === false) {
      if (window.innerWidth < 768) {
        toggleProfileSidebar();
      }
    }
  });

  const userDetails = [
    {
      i18n_label: "profile.details.joined_on",
      value: renderFormattedDate(userData?.date_joined ?? ""),
    },
    {
      i18n_label: "profile.details.time_zone",
      value: <ProfileSidebarTime timeZone={userData?.user_timezone} />,
    },
  ];

  useEffect(() => {
    const handleToggleProfileSidebar = () => {
      if (window && window.innerWidth < 768) {
        toggleProfileSidebar(true);
      }
      if (window && profileSidebarCollapsed && window.innerWidth >= 768) {
        toggleProfileSidebar(false);
      }
    };

    window.addEventListener("resize", handleToggleProfileSidebar);
    handleToggleProfileSidebar();
    return () => window.removeEventListener("resize", handleToggleProfileSidebar);
  }, []);

  // BARSOUL: 折叠 = 真正不渲染该面板，主内容自然回填整宽。
  // 原实现 style={{marginLeft: 整屏宽}} 推走面板——只对移动端 fixed 全屏
  // 覆盖变体有效；桌面 md:relative 300px 列时，巨大左边距把主内容挤出
  // 视口（用户实测："关闭把主窗口也关了，只剩左导航"）。return null 两种
  // 布局变体都正确；离开后再进入页面(remount)会重新显示，非永久陷阱。
  if (profileSidebarCollapsed) return null;

  return (
    <div
      className={cn(
        // BARSOUL: `fixed` を `max-md:fixed` に — Vite/新デザインシステム移行後
        // `md:relative` が基底 `fixed` を上書きできず(CSS層順序)、PC で fixed
        // 浮層が main を覆い内容を遮蔽(computed position=fixed, left=259 実測)。
        // 断点排他(<md だけ fixed、≥md は relative のみ)で衝突を根絶。
        `vertical-scrollbar max-md:fixed z-5 scrollbar-md h-full w-full shrink-0 overflow-hidden overflow-y-auto border-l border-subtle bg-surface-1 shadow-raised-200 transition-all md:relative md:w-[300px]`,
        className
      )}
    >
      {userProjectsData ? (
        <>
          {/* BARSOUL: 该面板以 fixed 覆盖在内容前且无关闭入口，outside-click
              仅 <768 生效（满屏时无"外部"可点 → 死锁）。关闭按钮必须 1) 始终
              可见(不能 md:hidden，桌面正是被覆盖的场景) 2) sticky 不随面板滚动
              消失(上一版放封面区顶部，一滚就没了 = 等于没修)。h-0 sticky 容器
              让按钮悬浮在左上角且不占布局，点击 toggleProfileSidebar(true)
              折叠（marginLeft 推出屏幕，fixed/relative 任意尺寸均生效）。 */}
          <div className="sticky top-0 z-30 h-0">
            <div className="absolute left-3 top-3">
              <Tooltip tooltipContent="閉じる / 关闭">
                <IconButton
                  variant="secondary"
                  icon={X}
                  onClick={() => toggleProfileSidebar(true)}
                />
              </Tooltip>
            </div>
          </div>
          <div className="relative h-[110px]">
            {currentUser?.id === userId && (
              <div className="absolute top-3.5 right-3.5">
                <IconButton
                  variant="secondary"
                  icon={EditIcon}
                  onClick={() =>
                    toggleProfileSettingsModal({
                      activeTab: "general",
                      isOpen: true,
                    })
                  }
                />
              </div>
            )}
            {/* BARSOUL: 封面なし時は壊れた既定画像(本番ビルドで読めず黒帯=遮蔽に見える)
                を出さず、ブランド色グラデーションを描画。h-[110px] 固定で高さ崩れ防止。 */}
            {userData?.cover_image_url ? (
              <CoverImage
                src={userData.cover_image_url}
                alt={userData?.display_name}
                className="h-[110px] w-full"
              />
            ) : (
              <div className="h-[110px] w-full bg-gradient-to-br from-accent-primary to-accent-primary/40" />
            )}
            <div className="absolute -bottom-[26px] left-5 h-[52px] w-[52px] rounded-sm">
              {userData?.avatar_url && userData?.avatar_url !== "" ? (
                <img
                  src={getFileURL(userData?.avatar_url)}
                  alt={userData?.display_name}
                  className="h-full w-full rounded-sm object-cover"
                />
              ) : (
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-sm bg-accent-primary text-on-color capitalize">
                  {userData?.first_name?.[0]}
                </div>
              )}
            </div>
          </div>
          <div className="px-5">
            <div className="mt-[38px]">
              <h4 className="text-16 font-semibold">
                {userData?.first_name} {userData?.last_name}
              </h4>
              <h6 className="text-13 text-secondary">({userData?.display_name})</h6>
            </div>
            <div className="mt-6 space-y-5">
              {userDetails.map((detail) => (
                <div key={detail.i18n_label} className="flex items-center gap-4 text-13">
                  <div className="w-2/5 flex-shrink-0 text-secondary">{t(detail.i18n_label)}</div>
                  <div className="w-3/5 font-medium break-words">{detail.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-9 divide-y divide-subtle">
              {userProjectsData.project_data.map((project, index) => {
                const projectDetails = getProjectById(project.id);

                const totalIssues =
                  project.created_issues + project.assigned_issues + project.pending_issues + project.completed_issues;

                const completedIssuePercentage =
                  project.assigned_issues === 0
                    ? 0
                    : Math.round((project.completed_issues / project.assigned_issues) * 100);

                if (!projectDetails) return null;

                return (
                  <Disclosure key={project.id} as="div" className={`${index === 0 ? "pb-3" : "py-3"}`}>
                    {({ open }) => (
                      <div className="w-full">
                        <Disclosure.Button className="flex w-full items-center justify-between gap-2">
                          <div className="flex w-3/4 items-center gap-2">
                            <span className="grid h-7 w-7 flex-shrink-0 place-items-center">
                              <Logo logo={projectDetails.logo_props} />
                            </span>
                            <div className="truncate text-13 font-medium break-words">{projectDetails.name}</div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            {project.assigned_issues > 0 && (
                              <Tooltip tooltipContent="Completion percentage" position="left" isMobile={isMobile}>
                                <div
                                  className={`rounded-sm px-1 py-0.5 text-11 font-medium ${
                                    completedIssuePercentage <= 35
                                      ? "bg-danger-subtle text-danger-primary"
                                      : completedIssuePercentage <= 70
                                        ? "bg-yellow-500/10 text-yellow-500"
                                        : "bg-success-subtle text-success-primary"
                                  }`}
                                >
                                  {completedIssuePercentage}%
                                </div>
                              </Tooltip>
                            )}
                            <ChevronDownIcon className="h-4 w-4" />
                          </div>
                        </Disclosure.Button>
                        <Transition
                          show={open}
                          enter="transition duration-100 ease-out"
                          enterFrom="transform opacity-0"
                          enterTo="transform opacity-100"
                          leave="transition duration-75 ease-out"
                          leaveFrom="transform opacity-100"
                          leaveTo="transform opacity-0"
                        >
                          <Disclosure.Panel className="mt-5 pl-9">
                            {totalIssues > 0 && (
                              <div className="flex items-center gap-0.5">
                                <div
                                  className="h-1 rounded-sm"
                                  style={{
                                    backgroundColor: "#203b80",
                                    width: `${(project.created_issues / totalIssues) * 100}%`,
                                  }}
                                />
                                <div
                                  className="h-1 rounded-sm"
                                  style={{
                                    backgroundColor: "#3f76ff",
                                    width: `${(project.assigned_issues / totalIssues) * 100}%`,
                                  }}
                                />
                                <div
                                  className="h-1 rounded-sm"
                                  style={{
                                    backgroundColor: "#f59e0b",
                                    width: `${(project.pending_issues / totalIssues) * 100}%`,
                                  }}
                                />
                                <div
                                  className="h-1 rounded-sm"
                                  style={{
                                    backgroundColor: "#16a34a",
                                    width: `${(project.completed_issues / totalIssues) * 100}%`,
                                  }}
                                />
                              </div>
                            )}
                            <div className="mt-7 space-y-5 text-13 text-secondary">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-xs bg-[#203b80]" />
                                  Created
                                </div>
                                <div className="font-medium">
                                  {project.created_issues} {t("issues")}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-xs bg-[#3f76ff]" />
                                  Assigned
                                </div>
                                <div className="font-medium">
                                  {project.assigned_issues} {t("issues")}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-xs bg-[#f59e0b]" />
                                  Due
                                </div>
                                <div className="font-medium">
                                  {project.pending_issues} {t("issues")}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-xs bg-[#16a34a]" />
                                  Completed
                                </div>
                                <div className="font-medium">
                                  {project.completed_issues} {t("issues")}
                                </div>
                              </div>
                            </div>
                          </Disclosure.Panel>
                        </Transition>
                      </div>
                    )}
                  </Disclosure>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <Loader className="space-y-7 px-5">
          <Loader.Item height="130px" />
          <div className="space-y-5">
            <Loader.Item height="20px" />
            <Loader.Item height="20px" />
            <Loader.Item height="20px" />
            <Loader.Item height="20px" />
            <Loader.Item height="20px" />
          </div>
        </Loader>
      )}
    </div>
  );
});
