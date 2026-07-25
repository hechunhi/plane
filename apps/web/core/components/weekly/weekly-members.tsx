/**
 * BARSOUL 週次ミーティング — メンバー選択 (hechun 2026-07-24)
 *
 * 会議は「人 → 人」で進むので、誰の番かが常に見えていること。広い画面では
 * 左に固定レール(名前 + 件数の帯 + 生成状態)、狭い画面では横スクロールの
 * チップ列に落とす — 会議はスマホで開かれることも多い。
 *
 * 状態ドットが表すのは **下書きの生成状態と確定の有無** だけ。人の評価は出さない
 * (産品決定 条件③「評価語を出さない」の UI 側の帰結)。
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "@plane/i18n";
import { Avatar } from "@plane/ui";
import { cn } from "@plane/utils";
import type { TWeeklyEntry } from "@/services/weekly.service";

export type MemberState = "idle" | "queued" | "running" | "ready" | "confirmed" | "failed";

export function entryState(e: TWeeklyEntry): MemberState {
  if (e.draft_status === "RUNNING") return "running";
  if (e.draft_status === "QUEUED") return "queued";
  if (e.draft_status === "FAILED") return "failed";
  if ((e.content_html || "").trim()) return "confirmed";
  if ((e.draft_html || "").trim()) return "ready";
  return "idle";
}

const DOT: Record<MemberState, string> = {
  idle: "bg-[var(--border-color-strong)]",
  queued: "bg-[var(--text-color-tertiary)] animate-pulse",
  running: "bg-accent-primary animate-pulse",
  ready: "bg-accent-primary",
  confirmed: "bg-success-primary",
  failed: "bg-danger-primary",
};

function StateDot({ state, title }: { state: MemberState; title?: string }) {
  return <span title={title} className={cn("size-1.5 shrink-0 rounded-full", DOT[state])} />;
}

/** 件数を帯で見せる — 数字だけだと「多い/少ない」が一瞬で入ってこない。 */
function StatBar({ entry }: { entry: TWeeklyEntry }) {
  const s = entry.stats || {};
  const seg = [
    { n: s.done || 0, cls: "bg-success-primary" },
    { n: s.progress || 0, cls: "bg-accent-primary" },
    { n: s.discussion || 0, cls: "bg-warning-primary" },
  ];
  const total = seg.reduce((a, b) => a + b.n, 0);
  if (!total) return <span className="h-1 w-full rounded-full bg-layer-2" />;
  return (
    <span className="flex h-1 w-full gap-px overflow-hidden rounded-full">
      {seg.map((x, i) =>
        x.n ? <span key={i} className={cn("h-full", x.cls)} style={{ flexGrow: x.n }} /> : null
      )}
    </span>
  );
}

type Props = {
  entries: TWeeklyEntry[];
  activeId: string | null;
  onSelect: (entryId: string) => void;
};

export function WeeklyMemberRail({ entries, activeId, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("weekly.members.title")} className="flex flex-col gap-1">
      <h3 className="px-2 pb-1 text-11 font-medium tracking-wide text-tertiary uppercase">
        {t("weekly.members.title")}
      </h3>
      {entries.map((e) => {
        const st = entryState(e);
        const active = e.id === activeId;
        const s = e.stats || {};
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
              active ? "bg-layer-1-selected" : "hover:bg-layer-1"
            )}
          >
            <Avatar
              name={e.member?.display_name}
              src={e.member?.avatar_url}
              size="md"
              shape="circle"
              showTooltip={false}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "truncate text-13 leading-tight",
                    active ? "font-medium text-primary" : "text-secondary"
                  )}
                >
                  {e.member?.display_name || "—"}
                </span>
                <StateDot state={st} title={t(`weekly.states.${st}`)} />
                <span className="flex-1" />
                <span className="shrink-0 text-11 tabular-nums text-placeholder">
                  {(s.done || 0) + (s.progress || 0) + (s.discussion || 0)}
                </span>
              </span>
              <StatBar entry={e} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** 狭い画面用。選択中を自動で視界へ入れる(横スクロールは迷子になりやすい)。 */
export function WeeklyMemberStrip({ entries, activeId, onSelect }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (!box || !el) return;
    // scrollIntoView は **祖先を全部** 巻き込んで動かす(overflow:hidden の祖先も
    // スクリプトからは動く)。画面ごと横にずれて、スクロールバーが無いので戻せない。
    // なのでこの帯だけを自前で動かす。
    const b = box.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const delta = e.left - b.left - (b.width - e.width) / 2;
    if (Math.abs(delta) > 1) box.scrollTo({ left: box.scrollLeft + delta, behavior: "smooth" });
  }, [activeId]);

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={t("weekly.members.title")}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {entries.map((e) => {
        const st = entryState(e);
        const active = e.id === activeId;
        const s = e.stats || {};
        return (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? "true" : "false"}
            onClick={() => onSelect(e.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border py-1.5 pr-3 pl-1.5 transition-colors",
              active
                ? "border-accent-subtle bg-accent-subtle text-accent-primary"
                : "border-subtle bg-layer-transparent text-secondary hover:bg-layer-1"
            )}
          >
            <Avatar
              name={e.member?.display_name}
              src={e.member?.avatar_url}
              size="sm"
              shape="circle"
              showTooltip={false}
            />
            <span className="max-w-[9rem] truncate text-12 leading-tight">{e.member?.display_name || "—"}</span>
            <span className="text-11 tabular-nums opacity-60">
              {(s.done || 0) + (s.progress || 0) + (s.discussion || 0)}
            </span>
            <StateDot state={st} title={t(`weekly.states.${st}`)} />
          </button>
        );
      })}
    </div>
  );
}
