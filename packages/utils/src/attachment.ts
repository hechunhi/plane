/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const generateFileName = (fileName: string) => {
  const date = new Date();
  const timestamp = date.getTime();

  const _fileName = getFileName(fileName);
  const nameWithoutExtension = _fileName.length > 80 ? _fileName.substring(0, 80) : _fileName;
  const extension = getFileExtension(fileName);

  return `${nameWithoutExtension}-${timestamp}.${extension}`;
};

export const getFileExtension = (filename: string) => filename.slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2);

export const getFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf(".");

  const nameWithoutExtension = fileName.substring(0, dotIndex);

  return nameWithoutExtension;
};

export const convertBytesToSize = (bytes: number) => {
  let size;

  if (bytes < 1024 * 1024) {
    size = Math.round(bytes / 1024) + " KB";
  } else {
    size = Math.round(bytes / (1024 * 1024)) + " MB";
  }

  return size;
};

// BARSOUL 2026-06-07 (hechun): 附件内联预览类型判定(mime 优先, 扩展名兜底)。
// image/* → <img>(含 svg; 经 <img> 加载不执行脚本, 安全);pdf/text → <iframe ?disposition=inline>。
export type TAttachmentPreviewKind = "image" | "pdf" | "text" | null;
const _PREVIEW_TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "log", "json", "yml", "yaml", "xml"]);
export const getAttachmentPreviewKind = (mime?: string, ext?: string): TAttachmentPreviewKind => {
  const m = (mime || "").toLowerCase();
  const e = (ext || "").toLowerCase();
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(e)) return "image";
  if (m === "application/pdf" || e === "pdf") return "pdf";
  if (m.startsWith("text/") || _PREVIEW_TEXT_EXT.has(e)) return "text";
  return null;
};
