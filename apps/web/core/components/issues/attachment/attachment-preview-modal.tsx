/**
 * BARSOUL 2026-06-07 (hechun): 附件内联预览浮层。
 * - 图片 → <img>;PDF/文本 → <iframe ?disposition=inline>(后端 issue attachment GET 支持
 *   该 query, 默认仍 attachment 下载)。资源走 /api/assets cookie 鉴权端点(浏览器自动带
 *   cookie → 302 presigned);<img>/<iframe> 忽略 Content-Disposition, 内联渲染。
 * - 始终提供「下载 / 新标签打开」兜底(不可预览类型直接走下载, 不开本浮层)。
 * - 在 issue peek 面板内打开 → 内容根加 data-prevent-outside-click(+ onMouseDown stop),
 *   防 ModalCore portal 出 peek ref 外被误判「点外部」收起面板(同审批弹层踩过的坑)。
 * - 多语言: 标签内联 zh/ja/en(仅 3 个短词, 不进 i18n 文件)。
 */
"use client";

import { Download, ExternalLink, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { getFileURL, type TAttachmentPreviewKind } from "@plane/utils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  kind: TAttachmentPreviewKind;
  assetUrl: string;
  fileName: string;
};

export function AttachmentPreviewModal({ isOpen, onClose, kind, assetUrl, fileName }: Props) {
  const { currentLocale } = useTranslation();
  const lang: "zh" | "ja" | "en" = currentLocale === "ja" ? "ja" : currentLocale === "en" ? "en" : "zh";
  const L = {
    download: { zh: "下载", ja: "ダウンロード", en: "Download" }[lang],
    openTab: { zh: "新标签打开", ja: "新しいタブで開く", en: "Open in new tab" }[lang],
    close: { zh: "关闭", ja: "閉じる", en: "Close" }[lang],
  };

  const baseURL = getFileURL(assetUrl);
  // URL が解決できない添付(assetUrl が空)は開いても白い枠が出るだけ。何も出さない。
  if (!baseURL) return null;
  const inlineURL = baseURL + (baseURL.includes("?") ? "&" : "?") + "disposition=inline";
  const downloadFile = () => window.open(baseURL, "_blank"); // attachment disposition → 浏览器下载

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={onClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.VIIXL}
      className="overflow-hidden"
    >
      {/* 防 peek 面板误收起(同审批弹层) */}
      <div data-prevent-outside-click onMouseDown={(e) => e.stopPropagation()} className="flex h-[88vh] flex-col">
        {/* header */}
        <div className="flex items-center gap-2 border-b-[0.5px] border-subtle px-4 py-2.5">
          <span className="truncate text-sm font-medium text-primary" title={fileName}>
            {fileName}
          </span>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" prependIcon={<Download className="size-3.5" />} onClick={downloadFile}>
              {L.download}
            </Button>
            <a
              href={inlineURL}
              target="_blank"
              rel="noopener noreferrer"
              title={L.openTab}
              className="grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-layer-1 hover:text-primary"
            >
              <ExternalLink className="size-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label={L.close}
              className="grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-layer-1 hover:text-primary"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-layer-1">
          {kind === "image" ? (
            <img src={baseURL} alt={fileName} className="max-h-full max-w-full object-contain" />
          ) : kind === "pdf" || kind === "text" ? (
            <iframe src={inlineURL} title={fileName} className="h-full w-full border-0 bg-surface-1" />
          ) : null}
        </div>
      </div>
    </ModalCore>
  );
}
