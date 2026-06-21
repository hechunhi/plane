/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Ban, ChevronDown, Link2, Type, type LucideIcon } from "lucide-react";

import { EIssueCommentAccessSpecifier } from "@plane/constants";
// editor
import { COLORS_LIST } from "@plane/editor";
import type { EditorRefApi } from "@plane/editor";
// i18n
import { useTranslation } from "@plane/i18n";
// ui
import { Button } from "@plane/propel/button";
import { GlobeIcon, LockIcon } from "@plane/propel/icons";
import type { ISvgIcons } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
// constants
import { cn } from "@plane/utils";
import type { ToolbarMenuItem } from "@/constants/editor";
import { TOOLBAR_ITEMS } from "@/constants/editor";
// helpers

type Props = {
  accessSpecifier?: EIssueCommentAccessSpecifier;
  executeCommand: (item: ToolbarMenuItem) => void;
  handleAccessChange?: (accessKey: EIssueCommentAccessSpecifier) => void;
  handleSubmit: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  isCommentEmpty: boolean;
  isSubmitting: boolean;
  showAccessSpecifier: boolean;
  showSubmitButton: boolean;
  editorRef: EditorRefApi | null;
  submitButtonText?: string;
};

type TCommentAccessType = {
  icon: LucideIcon | React.FC<ISvgIcons>;
  key: EIssueCommentAccessSpecifier;
  label: "Private" | "Public";
};

const COMMENT_ACCESS_SPECIFIERS: TCommentAccessType[] = [
  {
    icon: LockIcon,
    key: EIssueCommentAccessSpecifier.INTERNAL,
    label: "Private",
  },
  {
    icon: GlobeIcon,
    key: EIssueCommentAccessSpecifier.EXTERNAL,
    label: "Public",
  },
];

const toolbarItems = TOOLBAR_ITEMS.lite;

// BARSOUL(2026-06-15): ColorDropdown 已并入 TextStyleDropdown(颜色收进 T 下拉, 用户点名)。

// BARSOUL: 文本样式下拉(T)的段落选项 — 正文/标题1-3, 对齐 bubble menu 的 NodeSelector。
const NODE_OPTIONS: { key: "text" | "h1" | "h2" | "h3"; zh: string; ja: string }[] = [
  { key: "text", zh: "正文", ja: "本文" },
  { key: "h1", zh: "大标题", ja: "大見出し" },
  { key: "h2", zh: "中标题", ja: "中見出し" },
  { key: "h3", zh: "小标题", ja: "小見出し" },
];
// BARSOUL(2026-06-15 用户点名「颜色收进 T 下拉」): T = 文本样式 + 颜色 统一下拉。
// 段落样式(正文/标题) + 文字色 + 背景色 一处收敛, 不再单独的颜色按钮(放最后/icon 看不懂)。
function TextStyleDropdown({ editorRef }: { editorRef: EditorRefApi | null }) {
  const { currentLocale } = useTranslation();
  const ja = currentLocale === "ja";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const applyNode = (key: "text" | "h1" | "h2" | "h3") => {
    // 分支让 itemKey 字面量化(避免联合在 executeMenuItemCommand 泛型上 mismatch)
    if (key === "text") editorRef?.executeMenuItemCommand({ itemKey: "text" });
    else if (key === "h1") editorRef?.executeMenuItemCommand({ itemKey: "h1" });
    else if (key === "h2") editorRef?.executeMenuItemCommand({ itemKey: "h2" });
    else editorRef?.executeMenuItemCommand({ itemKey: "h3" });
    setOpen(false);
  };
  const applyColor = (kind: "text" | "bg", color: string | undefined) => {
    if (kind === "text") editorRef?.executeMenuItemCommand({ itemKey: "text-color", color });
    else editorRef?.executeMenuItemCommand({ itemKey: "background-color", color });
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative flex items-stretch">
      <Tooltip tooltipContent={ja ? "文字スタイルと色" : "文本样式与颜色"}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn("flex items-center gap-0.5 rounded-xs px-1 text-placeholder hover:bg-layer-1", {
            "bg-layer-1 text-primary": open,
          })}
        >
          <Type className="h-3.5 w-3.5" strokeWidth={2.5} />
          <ChevronDown className="h-3 w-3" />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-max min-w-44 space-y-2 rounded-md border-[0.5px] border-strong bg-surface-1 p-2 shadow-raised-200">
          <div className="space-y-0.5">
            <p className="px-1 text-10 font-semibold tracking-wide text-placeholder uppercase">
              {ja ? "段落スタイル" : "段落样式"}
            </p>
            {NODE_OPTIONS.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => applyNode(n.key)}
                className="block w-full rounded-sm px-2 py-1 text-left text-13 text-secondary hover:bg-layer-1"
              >
                {ja ? n.ja : n.zh}
              </button>
            ))}
          </div>
          <div className="bg-subtle h-px" />
          <div className="space-y-1">
            <p className="px-1 text-10 font-semibold tracking-wide text-placeholder uppercase">文字色</p>
            <div className="flex items-center gap-1.5">
              {COLORS_LIST.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  title={c.label}
                  onClick={() => applyColor("text", c.key)}
                  className="size-6 flex-shrink-0 rounded-sm border-[0.5px] border-strong-1 transition-opacity hover:opacity-60"
                  style={{ backgroundColor: c.textColor }}
                />
              ))}
              <button
                type="button"
                title={ja ? "クリア" : "清除"}
                onClick={() => applyColor("text", undefined)}
                className="grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong-1 text-tertiary hover:bg-layer-1"
              >
                <Ban className="size-4" />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <p className="px-1 text-10 font-semibold tracking-wide text-placeholder uppercase">背景色</p>
            <div className="flex items-center gap-1.5">
              {COLORS_LIST.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  title={c.label}
                  onClick={() => applyColor("bg", c.key)}
                  className="size-6 flex-shrink-0 rounded-sm border-[0.5px] border-strong-1 transition-opacity hover:opacity-60"
                  style={{ backgroundColor: c.backgroundColor }}
                />
              ))}
              <button
                type="button"
                title={ja ? "クリア" : "清除"}
                onClick={() => applyColor("bg", undefined)}
                className="grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong-1 text-tertiary hover:bg-layer-1"
              >
                <Ban className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// BARSOUL(2026-06-14): 链接下拉 — URL 输入, 对齐 bubble menu 的 LinkSelector。
function LinkDropdown({ editorRef }: { editorRef: EditorRefApi | null }) {
  const { currentLocale } = useTranslation();
  const ja = currentLocale === "ja";
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const apply = () => {
    const u = url.trim();
    if (!u) return;
    editorRef?.executeMenuItemCommand({ itemKey: "link", url: u });
    setUrl("");
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative flex items-stretch">
      <Tooltip tooltipContent={ja ? "リンク" : "链接"}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn("grid aspect-square place-items-center rounded-xs p-0.5 text-placeholder hover:bg-layer-1", {
            "bg-layer-1 text-primary": open,
          })}
        >
          <Link2 className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-1 flex w-56 items-center gap-1 rounded-md border-[0.5px] border-strong bg-surface-1 p-1.5 shadow-raised-200">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={ja ? "URL を貼り付け" : "粘贴链接 URL"}
            className="h-7 flex-1 rounded-sm border border-subtle bg-surface-1 px-2 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
          />
          <button
            type="button"
            onClick={apply}
            className="shrink-0 rounded-sm bg-accent-primary px-2 py-1 text-12 font-medium text-white hover:bg-accent-primary-hover"
          >
            {ja ? "確定" : "确认"}
          </button>
        </div>
      )}
    </div>
  );
}

// BARSOUL(2026-06-15 i18n): 工具按钮 tooltip(item.name 来自 TOOLBAR_ITEMS 英文常量)的 zh/ja。
// 不动共享常量(document 编辑器也用), 仅评论框 lite 工具条渲染时本地化; 未收录的回退英文。
const TOOLBAR_NAME_I18N: Record<string, { zh: string; ja: string }> = {
  Bold: { zh: "加粗", ja: "太字" },
  Italic: { zh: "斜体", ja: "斜体" },
  Underline: { zh: "下划线", ja: "下線" },
  Strikethrough: { zh: "删除线", ja: "取り消し線" },
  "Left align": { zh: "左对齐", ja: "左揃え" },
  "Center align": { zh: "居中对齐", ja: "中央揃え" },
  "Right align": { zh: "右对齐", ja: "右揃え" },
  "Numbered list": { zh: "有序列表", ja: "番号付きリスト" },
  "Bulleted list": { zh: "无序列表", ja: "箇条書き" },
  "To-do list": { zh: "待办清单", ja: "ToDo リスト" },
  Quote: { zh: "引用", ja: "引用" },
  Code: { zh: "代码", ja: "コード" },
  Image: { zh: "图片", ja: "画像" },
};
const ACCESS_I18N: Record<string, { zh: string; ja: string }> = {
  Private: { zh: "私密", ja: "非公開" },
  Public: { zh: "公开", ja: "公開" },
};

export function IssueCommentToolbar(props: Props) {
  const { t, currentLocale } = useTranslation();
  const ja = currentLocale === "ja";
  const {
    accessSpecifier,
    executeCommand,
    handleAccessChange,
    handleSubmit,
    isCommentEmpty,
    isSubmitting,
    showAccessSpecifier,
    showSubmitButton,
    editorRef,
    submitButtonText = "common.comment",
  } = props;
  // State to manage active states of toolbar items
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});

  // Function to update active states
  const updateActiveStates = useCallback(() => {
    if (!editorRef) return;
    const newActiveStates: Record<string, boolean> = {};
    Object.values(toolbarItems)
      .flat()
      .forEach((item) => {
        // TODO: update this while toolbar homogenization
        // @ts-expect-error type mismatch here
        newActiveStates[item.renderKey] = editorRef.isMenuItemActive({
          itemKey: item.itemKey,
          ...item.extraProps,
        });
      });
    setActiveStates(newActiveStates);
  }, [editorRef]);

  // useEffect to call updateActiveStates when isActive prop changes
  useEffect(() => {
    if (!editorRef) return;
    const unsubscribe = editorRef.onStateChange(updateActiveStates);
    updateActiveStates();
    return () => unsubscribe();
  }, [editorRef, updateActiveStates]);

  const isEditorReadyToDiscard = editorRef?.isEditorReadyToDiscard();
  const isSubmitButtonDisabled = isCommentEmpty || !isEditorReadyToDiscard;

  return (
    <div className="flex w-full items-start gap-1.5 bg-surface-2">
      {showAccessSpecifier && (
        <div className="flex flex-shrink-0 items-stretch gap-0.5 rounded-sm border-[0.5px] border-subtle p-1">
          {COMMENT_ACCESS_SPECIFIERS.map((access) => {
            const isAccessActive = accessSpecifier === access.key;

            return (
              <Tooltip key={access.key} tooltipContent={ACCESS_I18N[access.label]?.[ja ? "ja" : "zh"] ?? access.label}>
                <button
                  type="button"
                  onClick={() => handleAccessChange?.(access.key)}
                  className={cn("grid aspect-square place-items-center rounded-xs p-1 hover:bg-layer-1", {
                    "bg-layer-1": isAccessActive,
                  })}
                >
                  <access.icon
                    className={cn("h-3.5 w-3.5 text-placeholder", {
                      "text-primary": isAccessActive,
                    })}
                    strokeWidth={2}
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
      <div className="flex w-full items-start justify-between gap-2 rounded-sm border-[0.5px] border-subtle p-1">
        {/* BARSOUL(2026-06-15): 两排换行显示全部命令; 分组用间距(gap-x-2)而非 border-r
            竖线 — 换行时竖线会悬空显乱。组内 gap-0.5。 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* 文本样式(正文/标题)下拉 — 置最前 */}
          <TextStyleDropdown editorRef={editorRef} />
          {Object.keys(toolbarItems).map((key) => (
            <div key={key} className="flex items-center gap-0.5">
              {toolbarItems[key].map((item) => {
                const isItemActive = activeStates[item.renderKey];

                return (
                  <Tooltip
                    key={item.renderKey}
                    tooltipContent={
                      <p className="flex flex-col gap-1 text-center text-11">
                        <span className="font-medium">
                          {TOOLBAR_NAME_I18N[item.name]?.[ja ? "ja" : "zh"] ?? item.name}
                        </span>
                        {item.shortcut && <kbd className="text-placeholder">{item.shortcut.join(" + ")}</kbd>}
                      </p>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => executeCommand(item)}
                      className={cn(
                        "grid aspect-square place-items-center rounded-xs p-0.5 text-placeholder hover:bg-layer-1",
                        {
                          "bg-layer-1 text-primary": isItemActive,
                        }
                      )}
                    >
                      <item.icon
                        className={cn("h-3.5 w-3.5", {
                          "text-primary": isItemActive,
                        })}
                        strokeWidth={2.5}
                      />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          ))}
          {/* BARSOUL(2026-06-14): 链接 + 颜色 — 补齐 bubble menu 里缺的功能 */}
          <div className="flex items-stretch gap-0.5 pl-2.5">
            <LinkDropdown editorRef={editorRef} />
          </div>
        </div>
        {showSubmitButton && (
          <div className="sticky right-1">
            <Button
              type="submit"
              variant="primary"
              className="px-2.5 py-1.5 text-11"
              onClick={handleSubmit}
              disabled={isSubmitButtonDisabled}
              loading={isSubmitting}
            >
              {t(submitButtonText)}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
