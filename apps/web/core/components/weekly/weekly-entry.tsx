/**
 * BARSOUL 週次ミーティング — 1 人分の週報パネル (hechun 2026-07-24)
 *
 * 三層の境界を **画面の一番目立つところ** で見せる:
 *   「AI下書き」= 再生成で消える派生 / 「確定版」= 人が書いた SoR。
 * どちらを見ているか分からないまま会議が進むのが一番まずいので、
 * タブは折り畳まず常時表示する(産品決定 条件②「編集可能」の入口でもある)。
 *
 * 確定版の編集は **平文の箇条書き**。リッチエディタを載せない理由は
 * weekly-html.plainToWeeklyHtml のコメントを参照。
 */
import { AlertTriangle, Check, FileText, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Avatar, Tooltip } from "@plane/ui";
import { cn } from "@plane/utils";
import { weeklyService, type TWeeklyEntry } from "@/services/weekly.service";
import { blocksToPlain, parseWeeklyHtml, plainToWeeklyHtml, type WeeklyRef } from "./weekly-html";
import { WeeklyTranslate } from "./weekly-translate";

type Tab = "draft" | "final";

type Props = {
  workspaceSlug: string;
  meetingId: string;
  entry: TWeeklyEntry;
  readOnly?: boolean;
  onRefClick?: (projectId: string, issueId: string) => void;
  onEntryChange: (entry: TWeeklyEntry) => void;
  /** 再集計中は個別の再生成を伏せる(直列推論なので二重に投げても待つだけ)。 */
  busy?: boolean;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 生成待ちの間も画面を空にしない — 会議は待ってくれない。 */
function DraftSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-12 text-tertiary">
        <span className="inline-block size-3 animate-spin rounded-full border border-accent-primary border-t-transparent" />
        {label}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-2.5 w-24 animate-pulse rounded bg-layer-2" />
          <div className="h-3 w-full animate-pulse rounded bg-layer-2" style={{ animationDelay: `${i * 120}ms` }} />
          <div className="h-3 w-4/5 animate-pulse rounded bg-layer-2" style={{ animationDelay: `${i * 160}ms` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * 本文の真上に置く「今どっちを見ているか + 次の一手」の帯。
 * 週報は縦に長い。次の一手を下端に置くと、スクロールしない人には
 * 存在しないのと同じ(BS 現場で実際に「何もできない画面」と言われた)。
 */
function NoteBar({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-layer-1 px-3 py-2">
      <p className="min-w-0 flex-1 text-11 leading-relaxed text-tertiary">{text}</p>
      {action}
    </div>
  );
}

function EmptyBox({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-subtle px-6 py-10 text-center">
      <span className="text-tertiary">{icon}</span>
      <p className="text-13 text-secondary">{title}</p>
      {hint ? <p className="max-w-md text-11 leading-relaxed text-placeholder">{hint}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function WeeklyEntryPanel(props: Props) {
  const { workspaceSlug, meetingId, entry, readOnly, onRefClick, onEntryChange, busy } = props;
  const { t } = useTranslation();

  const hasContent = !!(entry.content_html || "").trim();
  const [tab, setTab] = useState<Tab>(hasContent ? "final" : "draft");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 人が切り替えた選択は尊重するが、メンバーが変われば既定へ戻す。
  useEffect(() => {
    setTab((entry.content_html || "").trim() ? "final" : "draft");
    setEditing(false);
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refByKey = useMemo(() => {
    const m = new Map<string, WeeklyRef>();
    for (const s of entry.sources || []) {
      const key = `${s.identifier}-${s.sequence_id}`;
      if (!m.has(key)) m.set(key, { key, projectId: s.project_id, issueId: s.issue_id });
    }
    return m;
  }, [entry.sources]);

  const toPlain = (html: string) => blocksToPlain(parseWeeklyHtml(html || ""));

  const startEdit = (seed: "content" | "draft") => {
    setText(toPlain(seed === "content" ? entry.content_html : entry.draft_html));
    setTab("final");
    setEditing(true);
    window.setTimeout(() => taRef.current?.focus(), 0);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await weeklyService.saveEntry(
        workspaceSlug,
        meetingId,
        entry.id,
        plainToWeeklyHtml(text, refByKey)
      );
      onEntryChange(updated);
      setEditing(false);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.final.saved") });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.final.save_failed") });
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const m = await weeklyService.refresh(workspaceSlug, meetingId, {
        generate: true,
        member_id: entry.member?.id,
      });
      const next = (m.entries || []).find((e) => e.id === entry.id);
      if (next) onEntryChange(next);
      setToast({ type: TOAST_TYPE.INFO, title: t("weekly.draft.queued_toast") });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.draft.failed") });
    } finally {
      setRegenerating(false);
    }
  };

  const status = entry.draft_status;
  const pending = status === "QUEUED" || status === "RUNNING";
  const draftMeta = [entry.model_used, fmtTime(entry.generated_at)].filter(Boolean).join(" · ");

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {/* 見出し: 誰の週報か + その人だけを作り直す口 */}
      <header className="flex flex-wrap items-center gap-3">
        <Avatar
          name={entry.member?.display_name}
          src={entry.member?.avatar_url}
          size="lg"
          shape="circle"
          showTooltip={false}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-16 leading-tight font-semibold text-primary">
            {entry.member?.display_name || "—"}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-11 text-placeholder">
            <span>
              {t("weekly.stats.done")} {entry.stats?.done || 0}
            </span>
            <span className="opacity-40">·</span>
            <span>
              {t("weekly.stats.progress")} {entry.stats?.progress || 0}
            </span>
            <span className="opacity-40">·</span>
            <span>
              {t("weekly.stats.discussion")} {entry.stats?.discussion || 0}
            </span>
          </p>
        </div>
        {!readOnly && (
          <Tooltip tooltipContent={t("weekly.draft.regenerate_hint")} position="bottom">
            <Button
              variant="secondary"
              size="base"
              onClick={() => void regenerate()}
              disabled={regenerating || pending || busy}
              prependIcon={<RefreshCw className={cn(regenerating && "animate-spin")} />}
            >
              {t("weekly.draft.regenerate")}
            </Button>
          </Tooltip>
        )}
      </header>

      {/* 派生 / SoR のタブ — どちらを見ているかを隠さない */}
      <div className="flex items-center gap-1 rounded-lg bg-layer-1 p-1">
        {(["draft", "final"] as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-selected={tab === k}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-12 transition-colors",
              tab === k
                ? "bg-surface-1 font-medium text-primary shadow-raised-100"
                : "text-tertiary hover:text-secondary"
            )}
          >
            {k === "draft" ? <Sparkles className="size-3.5" strokeWidth={1.75} /> : <FileText className="size-3.5" strokeWidth={1.75} />}
            {t(`weekly.tabs.${k}`)}
            {k === "final" && hasContent ? <Check className="size-3 text-success-primary" strokeWidth={2.5} /> : null}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-subtle bg-layer-transparent p-4 sm:p-5">
        {tab === "draft" ? (
          pending ? (
            <DraftSkeleton label={t(status === "RUNNING" ? "weekly.draft.running" : "weekly.draft.queued")} />
          ) : status === "FAILED" ? (
            <EmptyBox
              icon={<AlertTriangle className="size-5" strokeWidth={1.5} />}
              title={t("weekly.draft.failed")}
              hint={t("weekly.draft.failed_hint")}
              action={
                !readOnly ? (
                  <Button variant="secondary" size="base" onClick={() => void regenerate()} disabled={regenerating}>
                    {t("weekly.draft.retry")}
                  </Button>
                ) : undefined
              }
            />
          ) : (entry.draft_html || "").trim() ? (
            <div className="flex flex-col gap-3">
              {/* 「何を見ているか」と「次の一手」は本文の **上**。下に置くと、
                  20 件の箇条書きの底に沈んで、読むだけの画面に見えてしまう。 */}
              <NoteBar
                text={t("weekly.draft.note")}
                action={
                  !readOnly ? (
                    <Button
                      variant="primary"
                      size="base"
                      onClick={() => startEdit(hasContent ? "content" : "draft")}
                      prependIcon={<FileText />}
                    >
                      {t(hasContent ? "weekly.final.edit" : "weekly.final.from_draft")}
                    </Button>
                  ) : undefined
                }
              />
              <WeeklyTranslate
                workspaceSlug={workspaceSlug}
                entryId={entry.id}
                field="draft"
                html={entry.draft_html}
                sources={entry.sources || []}
                onRefClick={onRefClick}
              />
              {draftMeta ? (
                <p className="border-t border-subtle pt-3 text-11 text-placeholder">{draftMeta}</p>
              ) : null}
            </div>
          ) : (
            <EmptyBox
              icon={<Sparkles className="size-5" strokeWidth={1.5} />}
              title={t("weekly.draft.empty")}
              hint={t("weekly.draft.empty_hint")}
            />
          )
        ) : editing ? (
          <div className="flex flex-col gap-3">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={t("weekly.final.placeholder")}
              className={cn(
                "w-full resize-y rounded-md border border-subtle bg-surface-1 px-3 py-2.5",
                "font-mono text-12 leading-relaxed text-primary outline-none",
                "placeholder:text-placeholder focus:border-accent-strong"
              )}
            />
            <p className="text-11 leading-relaxed text-placeholder">{t("weekly.final.syntax_hint")}</p>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="base" onClick={() => void save()} loading={saving} prependIcon={<Check />}>
                {t("weekly.final.save")}
              </Button>
              <Button variant="ghost" size="base" onClick={() => setEditing(false)} prependIcon={<X />}>
                {t("weekly.final.cancel")}
              </Button>
            </div>
          </div>
        ) : hasContent ? (
          <div className="flex flex-col gap-3">
            <NoteBar
              text={t("weekly.final.note")}
              action={
                !readOnly ? (
                  <Button variant="secondary" size="base" onClick={() => startEdit("content")} prependIcon={<Pencil />}>
                    {t("weekly.final.edit")}
                  </Button>
                ) : undefined
              }
            />
            <WeeklyTranslate
              workspaceSlug={workspaceSlug}
              entryId={entry.id}
              field="content"
              html={entry.content_html}
              sources={entry.sources || []}
              onRefClick={onRefClick}
            />
            <p className="border-t border-subtle pt-3 text-11 text-placeholder">
              {entry.edited_by?.display_name
                ? `${entry.edited_by.display_name} · ${fmtTime(entry.edited_at)}`
                : fmtTime(entry.edited_at)}
            </p>
          </div>
        ) : (
          <EmptyBox
            icon={<FileText className="size-5" strokeWidth={1.5} />}
            title={t("weekly.final.empty")}
            hint={t("weekly.final.empty_hint")}
            action={
              !readOnly ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {(entry.draft_html || "").trim() ? (
                    <Button variant="primary" size="base" onClick={() => startEdit("draft")}>
                      {t("weekly.final.from_draft")}
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="base" onClick={() => startEdit("content")}>
                    {t("weekly.final.write")}
                  </Button>
                </div>
              ) : undefined
            }
          />
        )}
      </div>
    </section>
  );
}
