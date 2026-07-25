/**
 * BARSOUL 週次ミーティング — 出処パネル (hechun 2026-07-24)
 *
 * 産品決定 条件①「出処必須」の受け皿。下書きの各行は必ずここのどれかに紐づく。
 * **AI の文より出処の方が信用できる** ので、出処は折り畳みの奥ではなく
 * 常設の列に置く(広い画面)/ 直下の折り畳みに置く(狭い画面)。
 * 行クリック = peek — 会議画面から離脱させない。
 */
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import type { TWeeklySource } from "@/services/weekly.service";

type Bucket = "done" | "progress" | "discussion";

const BUCKETS: { key: Bucket; dot: string }[] = [
  { key: "done", dot: "bg-success-primary" },
  { key: "progress", dot: "bg-accent-primary" },
  { key: "discussion", dot: "bg-warning-primary" },
];

type Props = {
  sources: TWeeklySource[];
  onOpen?: (projectId: string, issueId: string) => void;
  /** 狭い画面では既定で畳む(週報本文を先に読ませる)。 */
  collapsible?: boolean;
  className?: string;
};

export function WeeklySources(props: Props) {
  const { sources, onOpen, collapsible = false, className } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(!collapsible);

  const groups = useMemo(() => {
    const g: Record<string, TWeeklySource[]> = { done: [], progress: [], discussion: [] };
    for (const s of sources || []) (g[s.bucket] ?? (g[s.bucket] = [])).push(s);
    return g;
  }, [sources]);

  const total = (sources || []).length;

  const body = (
    <div className="flex flex-col gap-4">
      {BUCKETS.map(({ key, dot }) => {
        const items = groups[key] || [];
        if (!items.length) return null;
        return (
          <section key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <span className={cn("size-1.5 rounded-full", dot)} />
              <h5 className="text-11 font-medium tracking-wide text-tertiary uppercase">
                {t(`weekly.buckets.${key}`)}
              </h5>
              <span className="text-11 tabular-nums text-placeholder">{items.length}</span>
            </div>
            <ul className="flex flex-col">
              {items.map((s) => (
                <li key={`${s.issue_id}_${s.at}_${s.kind}`}>
                  <button
                    type="button"
                    onClick={onOpen ? () => onOpen(s.project_id, s.issue_id) : undefined}
                    disabled={!onOpen}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      onOpen && "hover:bg-layer-1"
                    )}
                  >
                    <span className="mt-px shrink-0 font-mono text-[10px] leading-4 text-placeholder transition-colors group-hover:text-accent-primary">
                      {s.identifier}-{s.sequence_id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-12 leading-snug text-secondary transition-colors group-hover:text-primary">
                        {s.title}
                      </span>
                      {s.excerpt ? (
                        <span className="mt-0.5 line-clamp-1 text-11 leading-snug text-placeholder">{s.excerpt}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );

  return (
    <div className={cn("rounded-lg border border-subtle bg-layer-transparent", className)}>
      <button
        type="button"
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        disabled={!collapsible}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left",
          collapsible && "transition-colors hover:bg-layer-1"
        )}
      >
        <h4 className="text-12 font-medium text-secondary">{t("weekly.sources.title")}</h4>
        <span className="rounded-full bg-layer-1 px-1.5 text-11 tabular-nums text-tertiary">{total}</span>
        <span className="flex-1" />
        {collapsible && (
          <ChevronDown
            className={cn("size-4 shrink-0 text-tertiary transition-transform", open && "rotate-180")}
            strokeWidth={1.75}
          />
        )}
      </button>
      {open && (
        <div className="border-t border-subtle p-2">
          {total ? (
            body
          ) : (
            <p className="px-2 py-6 text-center text-12 text-placeholder">{t("weekly.sources.empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
