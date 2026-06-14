/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
// plane constants
import type { EIssueCommentAccessSpecifier } from "@plane/constants";
// plane imports
import { LiteTextEditorWithRef } from "@plane/editor";
import type { EditorRefApi, ILiteTextEditorProps, TFileHandler } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import type { MakeOptional } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { EditorMentionsRoot } from "@/components/editor/embeds/mentions";
import { IssueCommentToolbar } from "@/components/editor/lite-text/toolbar";
// hooks
import { useEditorConfig, useEditorMention } from "@/hooks/editor";
import { useMember } from "@/hooks/store/use-member";
import { useParseEditorContent } from "@/hooks/use-parse-editor-content";
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
  const { t, currentLocale } = useTranslation();
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
    if (!isFullScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullScreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullScreen]);
  // B-8: 全屏内 Enter=换行(多行撰写), Cmd/Ctrl+Enter=发送; 平时 Enter 仍发送。
  // 经 enter-key 扩展(回调返 false=不提交); ref 让稳定回调始终读最新值(不重建编辑器)。
  const onEnterRef = useRef<((e?: unknown) => void) | undefined>(undefined);
  onEnterRef.current = (rest as { onEnterKeyPress?: (e?: unknown) => void }).onEnterKeyPress;
  const isFullScreenRef = useRef(isFullScreen);
  isFullScreenRef.current = isFullScreen;
  const handleEnter = useCallback(() => {
    if (isFullScreenRef.current) return false; // 全屏: 让 Enter 走默认换行
    onEnterRef.current?.();
    return true; // 平时: 拦截并提交
  }, []);
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

  const fsLabel = currentLocale === "ja" ? "全画面で書く" : "全屏编辑";
  const fsExitLabel = currentLocale === "ja" ? "全画面を終了（Esc）" : "退出全屏（Esc）";

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
          "fixed bottom-0 left-0 right-0 top-12 z-[200] m-0 flex flex-col items-center border-0 bg-surface-1 px-4 py-5 shadow-overlay-300 sm:px-6"
      )}
      onFocus={() => isFullVariant && !showToolbarInitially && setIsFocused(true)}
      onBlur={() => isFullVariant && !showToolbarInitially && setIsFocused(false)}
      onKeyDown={(e) => {
        if (!isFullScreen) return;
        // B-9: 全屏内 Cmd/Ctrl+Enter = 发送; 纯 Enter 阻止冒泡到 comment-create 最外层的
        // Enter 提交(那条路径绕过了 editor 的 handleEnter)→ 让 editor 正常换行。
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onEnterRef.current?.();
        } else if (e.key === "Enter") {
          e.stopPropagation();
        }
      }}
    >
      {editable && (
        <button
          type="button"
          onClick={() => {
            setIsFullScreen((f) => !f);
            setIsFocused(true);
          }}
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
              editable && (isFullScreen ? "h-full overflow-y-auto" : "max-h-[60vh] overflow-y-auto")
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
          />
        )}
      </div>

      {/* Full Toolbar - conditionally rendered */}
      {isFullVariant && editable && (
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
          />
        </div>
      )}
    </div>
  );
});

LiteTextEditor.displayName = "LiteTextEditor";
