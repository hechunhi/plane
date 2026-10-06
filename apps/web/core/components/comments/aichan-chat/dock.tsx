/**
 * BARSOUL 愛ちゃん私聊 — 後台 dock(2026-10-06, hechun「途中で他へ移ったら？後台モードは？」)
 *
 * 私聊パネルを閉じた / 別の課題・別ページへ移った後も、返答待ちは jobs.ts が続ける。
 * その「まだ考え中」「届いた」を見失わないための唯一の面がここ:
 *   ・画面右下の小さな札(1 課題 1 枚)。考え中 = 経過秒、届いた = 琥珀の点(行動信号)。
 *   ・札を押す = 送った時のページへ戻り、パネルを開き直す(返答はもうスレッドに入っている)。
 *   ・裏タブにいる時は tab-badge(title/favicon)に件数を出す —— sticky banner は貼らない方針。
 * パネルが開いている課題の札は出さない(返答はその場に出るので二重に知らせない)。
 *
 * 唯一マウント箇所: WorkspaceContentWrapper。
 */
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, Loader2, Sparkles, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { registerTabBadge, unregisterTabBadge } from "@/lib/tab-badge";
import { dismissJob, getJobsSnapshot, getServerJobsSnapshot, isPanelOpen, requestReopen, subscribeJobs } from "./jobs";
import type { TAichanJob } from "./jobs";

const BADGE_KEY = "aichan-chat-replies";

export function AichanChatDock() {
  const { t } = useTranslation();
  const router = useAppRouter();
  const jobs = useSyncExternalStore(subscribeJobs, getJobsSnapshot, getServerJobsSnapshot);
  const visible = Object.values(jobs)
    .filter((j) => !isPanelOpen(j.issueId))
    .sort((a, b) => a.startedAt - b.startedAt);
  const doneCount = visible.filter((j) => j.status === "done").length;
  const anyRunning = visible.some((j) => j.status === "running");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  useEffect(() => {
    registerTabBadge(BADGE_KEY, { priority: 30, glyph: "✦", count: doneCount });
  }, [doneCount]);
  useEffect(() => () => unregisterTabBadge(BADGE_KEY), []);

  if (!visible.length) return null;

  const open = (job: TAichanJob) => {
    requestReopen(job.issueId);
    const here = `${window.location.pathname}${window.location.search}`;
    if (here !== job.href) router.push(job.href);
  };

  return (
    <div
      className={cn(
        "pointer-events-none fixed right-3 z-[26] flex w-[min(320px,calc(100vw-1.5rem))] flex-col gap-1.5",
        // スマホは下部タブバーの上に置く
        "bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-4"
      )}
    >
      {visible.map((job) => {
        const sec = Math.max(0, Math.floor((now - job.startedAt) / 1000));
        const label =
          job.status === "running"
            ? t("aichan_chat.dock_running")
            : job.status === "done"
              ? t("aichan_chat.dock_done")
              : t("aichan_chat.dock_error");
        return (
          <div
            key={job.issueId}
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-subtle bg-surface-1 py-1.5 pr-1.5 pl-2.5 shadow-overlay-200"
          >
            <button
              type="button"
              onClick={() => open(job)}
              aria-label={`${t("aichan_chat.dock_open")}: ${label}`}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {job.status === "running" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-tertiary" />
              ) : job.status === "done" ? (
                <span className="relative grid size-3.5 shrink-0 place-items-center">
                  <Sparkles className="size-3.5 text-tertiary" />
                  {/* 琥珀 = 「見に行って」の行動信号 */}
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning-primary" />
                </span>
              ) : (
                <AlertCircle className="size-3.5 shrink-0 text-danger-primary" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-11 font-medium text-primary">
                  {label}
                  {job.status === "running" && <span className="ml-1 text-tertiary tabular-nums">{sec}s</span>}
                </span>
                <span className="block truncate text-11 text-tertiary">
                  {job.issueTitle || t("aichan_chat.dock_untitled")}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => dismissJob(job.issueId)}
              aria-label={t("aichan_chat.dock_dismiss")}
              title={t("aichan_chat.dock_dismiss")}
              className="grid size-6 shrink-0 place-items-center rounded text-tertiary transition-colors hover:bg-layer-2 hover:text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
