/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Type } from "lucide-react";
// plane constants
import type { EIssueCommentAccessSpecifier } from "@plane/constants";
// plane imports
import { LiteTextEditorWithRef } from "@plane/editor";
import type { EditorRefApi, ILiteTextEditorProps, TFileHandler } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Tooltip } from "@plane/propel/tooltip";
import type { MakeOptional } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { EditorMentionsRoot } from "@/components/editor/embeds/mentions";
import { IssueCommentToolbar } from "@/components/editor/lite-text/toolbar";
// hooks
import { useEditorConfig, useEditorMention } from "@/hooks/editor";
import { useMember } from "@/hooks/store/use-member";
import { useCompactViewport } from "@/hooks/use-compact-viewport";
import { useParseEditorContent } from "@/hooks/use-parse-editor-content";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web hooks
import { useEditorFlagging } from "@/plane-web/hooks/use-editor-flagging";
// plane web service
import { WorkspaceService } from "@/services/workspace.service";
import { LiteToolbar } from "./lite-toolbar";
const workspaceService = new WorkspaceService();

type LiteTextEditorWrapperProps = MakeOptional<
  Omit<ILiteTextEditorProps, "fileHandler" | "mentionHandler" | "extendedEditorProps">,
  "disabledExtensions" | "flaggedExtensions" | "getEditorMetaData"
> & {
  workspaceSlug: string;
  workspaceId: string;
  projectId?: string;
  accessSpecifier?: EIssueCommentAccessSpecifier;
  handleAccessChange?: (accessKey: EIssueCommentAccessSpecifier) => void;
  showAccessSpecifier?: boolean;
  showSubmitButton?: boolean;
  isSubmitting?: boolean;
  showToolbarInitially?: boolean;
  variant?: "full" | "lite" | "none";
  issue_id?: string;
  parentClassName?: string;
  editorClassName?: string;
  submitButtonText?: string;
  // B-21: 親が入力欄を畳んだ(帯に戻した)合図。全画面のまま送信 → 帯 → 次に開いたら
  //   いきなり全画面、を防ぐため、畳まれたら全画面状態を捨てる。
  isCollapsed?: boolean;
} & (
    | {
        editable: false;
      }
    | {
        editable: true;
        uploadFile: TFileHandler["upload"];
        duplicateFile: TFileHandler["duplicate"];
      }
  );

export const LiteTextEditor = React.forwardRef(function LiteTextEditor(
  props: LiteTextEditorWrapperProps,
  ref: React.ForwardedRef<EditorRefApi>
) {
  const { t } = useTranslation();
  const {
    containerClassName,
    editable,
    workspaceSlug,
    workspaceId,
    projectId,
    issue_id,
    accessSpecifier,
    handleAccessChange,
    showAccessSpecifier = false,
    showSubmitButton = true,
    isSubmitting = false,
    showToolbarInitially = true,
    variant = "full",
    parentClassName = "",
    placeholder = t("issue.comments.placeholder"),
    disabledExtensions: additionalDisabledExtensions = [],
    editorClassName = "",
    showPlaceholderOnEmpty = true,
    submitButtonText = "common.comment",
    isCollapsed = false,
    ...rest
  } = props;
  // states
  const isLiteVariant = variant === "lite";
  const isFullVariant = variant === "full";
  const [isFocused, setIsFocused] = useState(isFullVariant ? showToolbarInitially : true);
  const [editorRef, setEditorRef] = useState<EditorRefApi | null>(null);
  // BARSOUL B-7(评论框易用性): 全屏撰写 — 同实例 CSS 全屏(容器升格为 fixed 覆盖层,
  // 编辑器实例不变 → editorRef / bubble menu / @提及 / 图片 / 草稿全部零成本跟随)。
  const [isFullScreen, setIsFullScreen] = useState(false);
  useEffect(() => {
    if (isCollapsed) setIsFullScreen(false);
  }, [isCollapsed]);
  useEffect(() => {
    if (!isFullScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullScreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullScreen]);
  // B-8 → B-20(2026-09-18 用户点名「输入一半被误发」): 发送键统一为 Cmd/Ctrl+Enter,
  // Enter 一律换行(全屏与否都一样)。enter-key 扩展现在只绑 Mod-Enter, 这里的回调
  // 只在 Mod-Enter 时被调用; ref 让稳定回调始终读最新值(不重建编辑器)。
  const onEnterRef = useRef<((e?: unknown) => void) | undefined>(undefined);
  onEnterRef.current = (rest as { onEnterKeyPress?: (e?: unknown) => void }).onEnterKeyPress;
  const handleEnter = useCallback(() => {
    onEnterRef.current?.();
    return true;
  }, []);
  // B-20 移动端: 767px 以下换「紧凑撰写条」(格式开关 / 全屏 / 发送), 完整工具栏按需展开。
  const isCompact = useCompactViewport();
  const { platform } = usePlatformOS();
  const modKey = platform === "MacOS" ? "Cmd" : "Ctrl"; // 文字而非 ⌘ 符号:Windows 出身的人看不懂 ⌘
  const sendHint = t("issue.comments.send_hint", { mod: modKey });
  const [showFormatBar, setShowFormatBar] = useState(false);
  // editor flaggings
  const { liteText: liteTextEditorExtensions } = useEditorFlagging({
    workspaceSlug,
    projectId,
  });
  // store hooks
  const { getUserDetails } = useMember();
  // parse content
  const { getEditorMetaData } = useParseEditorContent({
    projectId,
    workspaceSlug,
  });
  // use editor mention
  const { fetchMentions } = useEditorMention({
    searchEntity: async (payload) =>
      await workspaceService.searchEntity(workspaceSlug, {
        ...payload,
        project_id: projectId,
        issue_id,
      }),
  });
  // editor config
  const { getEditorFileHandlers } = useEditorConfig();
  function isMutableRefObject<T>(ref: React.ForwardedRef<T>): ref is React.MutableRefObject<T | null> {
    return !!ref && typeof ref === "object" && "current" in ref;
  }
  // derived values
  const isEmpty = isCommentEmpty(props.initialValue);

  const fsLabel = t("issue.comments.fullscreen");
  const fsExitLabel = t("issue.comments.exit_fullscreen");
  const toggleFullScreen = () => {
    setIsFullScreen((f) => !f);
    setIsFocused(true);
  };
  // 桌面完整版: 全屏按钮悬浮在右上角(绝对定位); 移动端: 进紧凑条, 不再压住第一行文字。
  const showFloatingFullScreenButton = editable && !(isFullVariant && isCompact);

  return (
    <div
      className={cn(
        "relative rounded-sm border border-subtle",
        {
          "p-3": editable && !isLiteVariant,
        },
        parentClassName,
        // B-7/B-9: 全屏 = 同实例容器升格为 fixed 覆盖层(编辑器实例不变 → 所有能力跟随)。
        // top-12 让出顶栏(z-[27] header)高度避免遮挡第一行; z-[200] 压过面板内元素。
        isFullScreen &&
          "fixed bottom-0 left-0 right-0 top-12 z-[200] m-0 flex flex-col items-center border-0 bg-surface-1 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-overlay-300 sm:px-6"
      )}
      // B-20: 全屏时打标, 让外层(comment-create 根 sticky z-[20])用 has-[] 抬高 z —
      // 否则移动端底部导航(flex item z-[20], DOM 在后)会盖住撰写条。
      data-composer-fullscreen={isFullScreen ? "" : undefined}
      onFocus={() => isFullVariant && !showToolbarInitially && setIsFocused(true)}
      onBlur={() => isFullVariant && !showToolbarInitially && setIsFocused(false)}
    >
      {showFloatingFullScreenButton && (
        <button
          type="button"
          onClick={toggleFullScreen}
          title={isFullScreen ? fsExitLabel : fsLabel}
          aria-label={isFullScreen ? fsExitLabel : fsLabel}
          className="absolute right-1 top-1 z-[3] grid size-6 place-items-center rounded border-[0.5px] border-subtle bg-surface-1/90 text-tertiary shadow-sm backdrop-blur-sm transition-colors hover:bg-layer-1 hover:text-primary"
        >
          {isFullScreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      )}
      {/* Wrapper for lite toolbar layout */}
      <div
        className={cn(
          isLiteVariant && editable ? "flex items-end gap-1" : "",
          // B-9 全屏: 居中限宽列(max-w-3xl), 告别横跨宽屏/贴左边
          isFullScreen && "flex min-h-0 w-full max-w-3xl flex-1 flex-col"
        )}
      >
        {/* Main Editor - always rendered once */}
        <div className={cn(isLiteVariant && editable ? "min-w-0 flex-1" : "", isFullScreen && "flex min-h-0 flex-1 flex-col")}>
          <LiteTextEditorWithRef
            ref={ref}
            disabledExtensions={[...liteTextEditorExtensions.disabled, ...additionalDisabledExtensions]}
            editable={editable}
            flaggedExtensions={liteTextEditorExtensions.flagged}
            fileHandler={getEditorFileHandlers({
              projectId,
              uploadFile: editable ? props.uploadFile : async () => "",
              duplicateFile: editable ? props.duplicateFile : async () => "",
              workspaceId,
              workspaceSlug,
            })}
            getEditorMetaData={getEditorMetaData}
            handleEditorReady={(ready) => {
              if (ready) {
                setEditorRef(isMutableRefObject<EditorRefApi>(ref) ? ref.current : null);
              }
            }}
            mentionHandler={{
              searchCallback: async (query) => {
                const res = await fetchMentions(query);
                if (!res) throw new Error("Failed in fetching mentions");
                return res;
              },
              renderComponent: EditorMentionsRoot,
              getMentionedEntityDetails: (id) => ({
                display_name: getUserDetails(id)?.display_name ?? "",
              }),
            }}
            placeholder={placeholder}
            showPlaceholderOnEmpty={showPlaceholderOnEmpty}
            containerClassName={cn(
              containerClassName,
              "relative",
              { "p-2": !editable },
              // B-7 自适应高度: 随内容长高, 超 60vh 内部滚动; 全屏时撑满。
              // (评论框已无 bubble menu → overflow 不再裁浮层, 恢复限高滚动)
              editable && (isFullScreen ? "h-full overflow-y-auto" : "max-h-[60vh] overflow-y-auto"),
              // B-20: 让出右上角悬浮全屏按钮的位置, 第一行长文不再钻到按钮底下
              showFloatingFullScreenButton && !isFullScreen && "pr-7",
              // 移动端软键盘会吃掉一半视口, 限高再收一档
              editable && isCompact && !isFullScreen && "max-h-[40dvh]"
            )}
            extendedEditorProps={{}}
            editorClassName={editorClassName}
            {...rest}
            onEnterKeyPress={handleEnter}
          />
        </div>

        {/* Lite Toolbar - conditionally rendered */}
        {isLiteVariant && editable && (
          <LiteToolbar
            executeCommand={(item) => {
              // TODO: update this while toolbar homogenization
              // @ts-expect-error type mismatch here
              editorRef?.executeMenuItemCommand({
                itemKey: item.itemKey,
                ...item.extraProps,
              });
            }}
            onSubmit={(e) => rest.onEnterKeyPress?.(e)}
            isSubmitting={isSubmitting}
            isEmpty={isEmpty}
            sendLabel={t("issue.comments.send")}
            sendHint={sendHint}
            attachLabel={t("issue.comments.toolbar.attach")}
          />
        )}
      </div>

      {/* Full Toolbar — 桌面: focus 展开的完整工具栏(含发送 + 快捷键提示) */}
      {isFullVariant && editable && !isCompact && (
        <div
          className={cn(
            "origin-top transition-all duration-300 ease-out",
            // B-7/B-16: 全屏常驻底部; focus 展开后 overflow-visible — 否则 selector 下拉
            // (absolute 向上弹, 会超出工具条容器)被 overflow-hidden 裁掉无法展开。
            // 收起时 overflow-hidden 配 max-h-0 收起动画。
            isFullScreen
              ? "mt-3 w-full max-w-3xl shrink-0"
              : isFocused
                ? "mt-3 max-h-[400px] scale-y-100 overflow-visible opacity-100"
                : "invisible max-h-0 scale-y-0 overflow-hidden opacity-0"
          )}
        >
          <IssueCommentToolbar
            accessSpecifier={accessSpecifier}
            executeCommand={(item) => {
              // TODO: update this while toolbar homogenization
              // @ts-expect-error type mismatch here
              editorRef?.executeMenuItemCommand({
                itemKey: item.itemKey,
                ...item.extraProps,
              });
            }}
            handleAccessChange={handleAccessChange}
            handleSubmit={(e) => rest.onEnterKeyPress?.(e)}
            isCommentEmpty={isEmpty}
            isSubmitting={isSubmitting}
            showAccessSpecifier={showAccessSpecifier}
            editorRef={editorRef}
            showSubmitButton={showSubmitButton}
            submitButtonText={submitButtonText}
            submitHint={sendHint}
          />
        </div>
      )}

      {/* B-20 移动端紧凑撰写条: [格式 | 全屏] ……… [发送]; 完整工具栏只在点了「格式」后展开。
          之前 15 个图标两排常驻, 手机上占掉输入区一半; 现在默认一行 32px。 */}
      {isFullVariant && editable && isCompact && (
        <div className={cn("mt-2 flex flex-col gap-2", isFullScreen && "w-full max-w-3xl shrink-0")}>
          {showFormatBar && (
            <IssueCommentToolbar
              accessSpecifier={accessSpecifier}
              executeCommand={(item) => {
                // @ts-expect-error type mismatch here
                editorRef?.executeMenuItemCommand({
                  itemKey: item.itemKey,
                  ...item.extraProps,
                });
              }}
              handleAccessChange={handleAccessChange}
              handleSubmit={(e) => rest.onEnterKeyPress?.(e)}
              isCommentEmpty={isEmpty}
              isSubmitting={isSubmitting}
              showAccessSpecifier={showAccessSpecifier}
              editorRef={editorRef}
              showSubmitButton={false}
              submitButtonText={submitButtonText}
            />
          )}
          <div className="flex items-center gap-1">
            <Tooltip tooltipContent={t("issue.comments.toolbar.format")}>
              <button
                type="button"
                aria-label={t("issue.comments.toolbar.format")}
                aria-pressed={showFormatBar}
                onClick={() => setShowFormatBar((v) => !v)}
                className={cn(
                  "grid size-8 place-items-center rounded-sm border-[0.5px] border-subtle text-tertiary transition-colors hover:bg-layer-1 hover:text-primary",
                  showFormatBar && "bg-layer-1 text-accent-primary"
                )}
              >
                <Type className="size-4" strokeWidth={2} />
              </button>
            </Tooltip>
            <Tooltip tooltipContent={isFullScreen ? fsExitLabel : fsLabel}>
              <button
                type="button"
                aria-label={isFullScreen ? fsExitLabel : fsLabel}
                onClick={toggleFullScreen}
                className="grid size-8 place-items-center rounded-sm border-[0.5px] border-subtle text-tertiary transition-colors hover:bg-layer-1 hover:text-primary"
              >
                {isFullScreen ? <Minimize2 className="size-4" strokeWidth={2} /> : <Maximize2 className="size-4" strokeWidth={2} />}
              </button>
            </Tooltip>
            <div className="flex-1" />
            {showSubmitButton && (
              <Button
                type="button"
                variant="primary"
                className="h-8 px-3 text-11"
                onClick={(e) => rest.onEnterKeyPress?.(e)}
                disabled={isEmpty || !editorRef?.isEditorReadyToDiscard()}
                loading={isSubmitting}
              >
                {t(submitButtonText)}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

LiteTextEditor.displayName = "LiteTextEditor";
