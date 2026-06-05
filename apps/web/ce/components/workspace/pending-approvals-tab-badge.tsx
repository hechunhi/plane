/**
 * BARSOUL ADR-029 続: 提案 D — ブラウザタブの title prefix と favicon に
 * 待批件数バッジ. Plane を裏タブで開いてる時でも気づける(顶栏 + banner は
 * 当該タブを見ないと無効, 提案 A の盲点を埋める).
 *
 * 実装方針:
 * - title: MutationObserver で <title> の変化を観測 → prefix "(N) ⚖️ " を
 *   常に保つ. 個々のページの PageHead が title を上書きしても自動復元.
 * - favicon: canvas で 32×32 に既存 favicon を描き直し + 右下に赤円 + N
 *   を重ねる. count=0 で静的 favicon に戻す.
 * - 唯一マウント箇所: WorkspaceContentWrapper.
 */
"use client";
import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { useMyPendingApprovals } from "@/hooks/use-my-pending-approvals";

const TITLE_PREFIX_RE = /^\(\d+\) ⚖️ /;

// 既存 <link rel="icon"> から baseline favicon URL を抜く. bundler が hash
// 化するので path 直書き不可. 32×32 を優先, 無ければ最初に見つかった icon.
function detectBaseFaviconUrl(): string {
  if (typeof document === "undefined") return "";
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  // data-pending-approvals(自前で追加した動的 link) は除外
  const candidates = links.filter((l) => !l.hasAttribute("data-pending-approvals"));
  const png32 = candidates.find((l) => l.getAttribute("sizes") === "32x32");
  return (png32 || candidates[0])?.href || "";
}

function applyTitlePrefix(count: number) {
  if (typeof document === "undefined") return;
  const cur = document.title || "";
  const stripped = cur.replace(TITLE_PREFIX_RE, "");
  const next = count > 0 ? `(${count}) ⚖️ ${stripped}` : stripped;
  if (cur !== next) document.title = next;
}

function findOrCreateFaviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"][data-pending-approvals]');
  if (link) return link;
  // 既存 favicon link を尊重しつつ独自 link を 1 本追加
  link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.setAttribute("data-pending-approvals", "1");
  document.head.appendChild(link);
  return link;
}

async function renderFaviconWithBadge(count: number, baseUrl: string): Promise<string | null> {
  if (typeof window === "undefined" || !baseUrl) return null;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 既存 favicon 画像をベースに描く. 取得失敗時はキャンバスを透明のまま重ねるだけ.
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, size, size);
      } catch {
        /* tainted canvas — fall through to bare badge */
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = baseUrl;
  });

  // 右下に赤円 + 件数. 1 桁/2 桁/99+ で文字サイズ調整.
  const cx = size - 9;
  const cy = size - 9;
  const r = 9;
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  const label = count > 99 ? "99+" : String(count);
  const fontSize = label.length >= 3 ? 8 : label.length === 2 ? 10 : 12;
  ctx.font = `bold ${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);

  return canvas.toDataURL("image/png");
}

export const PendingApprovalsTabBadge = observer(function PendingApprovalsTabBadge() {
  const { pendingCount } = useMyPendingApprovals();
  const countRef = useRef(pendingCount);
  countRef.current = pendingCount;

  // ① title prefix — MutationObserver で永続適用
  useEffect(() => {
    if (typeof document === "undefined") return;
    applyTitlePrefix(pendingCount);
    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const obs = new MutationObserver(() => applyTitlePrefix(countRef.current));
    obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [pendingCount]);

  // ② favicon — count 変化のたびに再描画 (cancel guard で stale 上書き防止).
  // baseUrl は初回マウント時にスナップ; 後続 mutate で上書き競合しないように.
  const baseFaviconRef = useRef<string>("");
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!baseFaviconRef.current) baseFaviconRef.current = detectBaseFaviconUrl();
    let cancelled = false;
    const link = findOrCreateFaviconLink();
    if (!link) return;
    if (pendingCount === 0) {
      link.href = baseFaviconRef.current;
      return;
    }
    renderFaviconWithBadge(pendingCount, baseFaviconRef.current).then((dataUrl) => {
      if (cancelled || !dataUrl) return;
      link.href = dataUrl;
    });
    return () => {
      cancelled = true;
    };
  }, [pendingCount]);

  return null;
});
