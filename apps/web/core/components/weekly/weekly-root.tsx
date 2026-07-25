/**
 * BARSOUL 週次ミーティング — 画面ルート (hechun 2026-07-24)
 * 設計: docs/architecture/weekly-report-mvp.md
 *
 * 画面の役目は「会議を止めないこと」。だから:
 *   ・生成は非同期(1 人 ~70s の直列推論)→ 進捗は realtime-sse 経由で差分適用。
 *     再取得(revalidate)ではなく **該当エントリだけ差し替える** — 会議中に
 *     編集途中のテキストが飛ぶのが最悪だから。
 *   ・出処クリックは peek。画面遷移しない。
 *   ・広い画面 = レール + 本文 + 出処の 3 列。狭い画面 = チップ列 + 本文 + 折り畳み出処。
 */
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Lock,
  MessagesSquare,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { observer } from "mobx-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore, CustomMenu, Tooltip } from "@plane/ui";
import { cn } from "@plane/utils";
import { peerSync, type PeerOp } from "@/components/core/peer-sync";
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { weeklyService, type TWeeklyEntry, type TWeeklyMeeting } from "@/services/weekly.service";
import { WeeklyChat } from "./weekly-chat";
import { WeeklyEntryPanel } from "./weekly-entry";
import { WeeklyMemberRail, WeeklyMemberStrip } from "./weekly-members";
import { WeeklySources } from "./weekly-sources";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
};

/** 会期のまとめ。人ごとの偏りではなく「今週どれだけ動いたか」を出す(評価はしない)。 */
function StatCards({ entries }: { entries: TWeeklyEntry[] }) {
  const { t } = useTranslation();
  const agg = useMemo(() => {
    const a = { done: 0, progress: 0, discussion: 0, confirmed: 0 };
    for (const e of entries) {
      a.done += e.stats?.done || 0;
      a.progress += e.stats?.progress || 0;
      a.discussion += e.stats?.discussion || 0;
      if ((e.content_html || "").trim()) a.confirmed += 1;
    }
    return a;
  }, [entries]);

  const cards = [
    { key: "done", value: agg.done, accent: "text-success-primary" },
    { key: "progress", value: agg.progress, accent: "text-accent-primary" },
    { key: "discussion", value: agg.discussion, accent: "text-warning-primary" },
    { key: "confirmed", value: `${agg.confirmed}/${entries.length}`, accent: "text-secondary" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {cards.map((c) => (
        <div key={c.key} className="rounded-lg border border-subtle bg-layer-transparent px-3 py-2.5">
          <p className="truncate text-11 text-tertiary">{t(`weekly.stats.${c.key}`)}</p>
          <p className={cn("mt-0.5 text-20 leading-tight font-semibold tabular-nums", c.accent)}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export const WeeklyRoot = observer(function WeeklyRoot({ workspaceSlug }: { workspaceSlug: string }) {
  const { t } = useTranslation();
  const { setPeekIssue } = useIssueDetail();
  const { sidebarCollapsed, toggleSidebar } = useAppTheme();
  const { joinedProjectIds, getProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  // GUEST は閲覧のみ(API 側も同じ線引き)。押せないボタンを見せない。
  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug
  );

  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "sources" | "confirm" | "reopen" | "open" | "delete" | "page">("");
  // 確定は「会期を閉じる」終端操作。押した瞬間に全員の編集が止まるので、必ず訊く。
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** 22rem のドックだと長い発言が読めない問題を「常に最大化」で解消。
   *  ドック/最大化のトグルはもう無い — 開けば常にコンテナ内いっぱい。 */
  const [chatOpen, setChatOpen] = useState(false);
  // 会期名。新規会期は無名で始まるので日付だけになる — 会議中に口で指せない。
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const escaped = useRef(false);

  const { data: meetings, mutate: mutateList } = useSWR(
    workspaceSlug ? ["weekly-meetings", workspaceSlug] : null,
    () => weeklyService.list(workspaceSlug)
  );

  // 既定は「開いている会期」。無ければ直近。会議を開いたらまずここに居たい。
  useEffect(() => {
    if (meetingId || !meetings?.length) return;
    setMeetingId((meetings.find((m) => m.status === "OPEN") || meetings[0]).id);
  }, [meetings, meetingId]);

  /**
   * グローバル左サイドバーは幅 768px 未満で自動的に畳まれる(sidebar-wrapper.tsx)。
   * それ自体は他画面では正しい挙動だが、この画面は「同じ URL を開いた人ごとに
   * サイドバー有無で見た目が変わる」のを避けたい(会議中に画面共有で指す画面)。
   * マウント時に一度だけ強制的に畳んでおけば、ウィンドウ幅に関わらず毎回同じ
   * 見た目から始まる。手動で開き直すのは妨げない(閉じ続けさせるわけではない)。
   */
  useEffect(() => {
    if (sidebarCollapsed !== true) toggleSidebar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    data: meeting,
    mutate: mutateMeeting,
    isLoading,
  } = useSWR(
    workspaceSlug && meetingId ? ["weekly-meeting", workspaceSlug, meetingId] : null,
    () => weeklyService.detail(workspaceSlug, meetingId as string)
  );

  const entries = useMemo(() => meeting?.entries || [], [meeting]);

  useEffect(() => {
    if (!entries.length) return;
    if (activeEntryId && entries.some((e) => e.id === activeEntryId)) return;
    setActiveEntryId(entries[0].id);
  }, [entries, activeEntryId]);

  const activeEntry = entries.find((e) => e.id === activeEntryId) || null;

  /** 1 件だけ差し替える。編集中のテキストを飛ばさないための最小更新。 */
  const patchEntry = useCallback(
    (next: TWeeklyEntry | Partial<TWeeklyEntry>, id?: string) => {
      const targetId = (next as TWeeklyEntry).id || id;
      if (!targetId) return;
      void mutateMeeting(
        (cur?: TWeeklyMeeting) =>
          cur
            ? { ...cur, entries: (cur.entries || []).map((e) => (e.id === targetId ? { ...e, ...next } : e)) }
            : cur,
        { revalidate: false }
      );
    },
    [mutateMeeting]
  );

  // 生成の進捗 — サーバは PeerOp 形で流してくるので登録 1 箇所で済む。
  useEffect(() => {
    if (!meetingId) return;
    return peerSync.register("weekly", (op: PeerOp) => {
      if (String(op.meeting_id) !== meetingId) return;
      if (op.event === "weekly_entry") {
        const d = (op.data || {}) as Partial<TWeeklyEntry> & { entry_id?: string };
        patchEntry(d, d.entry_id);
      } else if (op.event === "weekly_done") {
        void mutateMeeting();
      }
    });
  }, [meetingId, patchEntry, mutateMeeting]);

  const openPeek = useCallback(
    (projectId: string, issueId: string) => {
      if (!projectId || !issueId) return;
      setPeekIssue({ workspaceSlug, projectId, issueId });
    },
    [setPeekIssue, workspaceSlug]
  );

  const run = async (kind: "refresh" | "sources" | "confirm" | "reopen" | "open" | "delete") => {
    setBusy(kind);
    try {
      if (kind === "delete") {
        const gone = meetingId;
        await weeklyService.remove(workspaceSlug, gone as string);
        const rest = await mutateList();
        setDeleteOpen(false);
        // 消した会期に居座らせない。開いている会期があればそこへ、無ければ直近へ。
        const next = (rest || []).filter((m) => m.id !== gone);
        setMeetingId(next.find((m) => m.status === "OPEN")?.id ?? next[0]?.id ?? null);
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.actions.deleted") });
      } else if (kind === "open") {
        const m = await weeklyService.open(workspaceSlug);
        await mutateList();
        setMeetingId(m.id);
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.actions.opened") });
      } else if (kind === "confirm") {
        await weeklyService.confirm(workspaceSlug, meetingId as string);
        await Promise.all([mutateMeeting(), mutateList()]);
        setConfirmOpen(false);
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.actions.confirmed") });
      } else if (kind === "reopen") {
        await weeklyService.reopen(workspaceSlug, meetingId as string);
        await Promise.all([mutateMeeting(), mutateList()]);
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.actions.reopened") });
      } else {
        const m = await weeklyService.refresh(workspaceSlug, meetingId as string, { generate: kind === "refresh" });
        void mutateMeeting(m, { revalidate: false });
        setToast({
          type: TOAST_TYPE.INFO,
          title: t(kind === "refresh" ? "weekly.actions.refresh_queued" : "weekly.actions.refreshed"),
        });
      }
    } catch (err) {
      // 409 は「直せる失敗」。何が邪魔しているかを言わないと打つ手が無くなる。
      const conflict = (err as { response?: { status?: number } })?.response?.status === 409;
      const key =
        conflict && kind === "reopen"
          ? "weekly.actions.reopen_conflict"
          : conflict && kind === "delete"
            ? "weekly.actions.delete_conflict"
            : "weekly.actions.failed";
      setToast({ type: TOAST_TYPE.ERROR, title: t(key) });
    } finally {
      setBusy("");
    }
  };

  /** 改名は SoR の書き換えだが、内容ではなく呼び名なので確認は挟まない(戻すのも一手)。 */
  const saveTitle = async () => {
    setRenaming(false);
    if (escaped.current) return void (escaped.current = false);
    const title = titleDraft.trim().slice(0, 255);
    if (!meeting || title === (meeting.title || "")) return;
    try {
      await weeklyService.patch_(workspaceSlug, meeting.id, { title });
      void mutateMeeting({ ...meeting, title }, { revalidate: false });
      await mutateList();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.actions.failed") });
    }
  };

  /**
   * 議事ノート。CE の Page は project 配下にしか置けないので、どの project かを決める必要がある。
   * 前回のノートと同じ project を既定にし、**初回だけ選ばせる**(産品決定 2026-07-25)。
   * 新しい設定項目を足さずに済み、2 回目以降は選択が消える。
   */
  const notesHref =
    meeting?.page_id && meeting?.page_project_id
      ? `/${workspaceSlug}/projects/${meeting.page_project_id}/pages/${meeting.page_id}`
      : null;
  // meetings は period_end の降順 — 最初に見つかったものが「前回」。
  const lastNotesProject = useMemo(() => {
    const id = (meetings || []).find((m) => m.page_project_id)?.page_project_id || null;
    return id && joinedProjectIds.includes(id) ? id : null;
  }, [meetings, joinedProjectIds]);

  const createNotes = async (projectId: string) => {
    if (!meeting) return;
    setBusy("page");
    try {
      const next = await weeklyService.createPage(workspaceSlug, meeting.id, projectId);
      // 返るのは会期だけ(entries を含まない)。丸ごと差し替えると週報が消える。
      void mutateMeeting(
        (cur?: TWeeklyMeeting) =>
          cur ? { ...cur, page_id: next.page_id, page_project_id: next.page_project_id } : cur,
        { revalidate: false }
      );
      await mutateList();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.notes.created") });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.actions.failed") });
    } finally {
      setBusy("");
    }
  };

  const confirmed = meeting?.status === "CONFIRMED";

  if (!meetings) return <div className="h-full animate-pulse bg-layer-transparent" />;

  if (!meetings.length)
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <CalendarDays className="size-8 text-tertiary" strokeWidth={1.25} />
          <h2 className="text-16 font-semibold text-primary">{t("weekly.empty.title")}</h2>
          <p className="text-12 leading-relaxed text-tertiary">{t("weekly.empty.hint")}</p>
          {canEdit && (
            <Button variant="primary" size="lg" onClick={() => void run("open")} loading={busy === "open"} prependIcon={<Plus />}>
              {t("weekly.actions.open")}
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 会期の切替と操作。会議中に一番押される場所なので上に固定する。 */}
      <div className="z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-subtle bg-surface-1 px-4 py-2 sm:px-6">
        {renaming ? (
          <input
            autoFocus
            value={titleDraft}
            maxLength={255}
            placeholder={t("weekly.actions.rename_placeholder")}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Escape") escaped.current = true;
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
            }}
            className="w-[14rem] rounded-md border border-accent-strong bg-layer-transparent px-2 py-1 text-13 font-medium text-primary outline-none"
          />
        ) : (
        <CustomMenu
          maxHeight="lg"
          closeOnSelect
          customButton={
            <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-13 font-medium text-primary transition-colors hover:bg-layer-1">
              <CalendarDays className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
              <span className="max-w-[14rem] truncate">
                {meeting?.title || (meeting ? `${fmtDate(meeting.period_start)} – ${fmtDate(meeting.period_end)}` : "—")}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
            </span>
          }
        >
          {meetings.map((m) => (
            <CustomMenu.MenuItem key={m.id} onClick={() => setMeetingId(m.id)}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    m.status === "OPEN" ? "bg-accent-primary" : "bg-[var(--border-color-strong)]"
                  )}
                />
                <span className="truncate">{m.title || `${fmtDate(m.period_start)} – ${fmtDate(m.period_end)}`}</span>
              </span>
            </CustomMenu.MenuItem>
          ))}
          {canEdit && meeting && (
            <>
              <div className="my-1 border-t border-subtle" />
              <CustomMenu.MenuItem
                onClick={() => {
                  setTitleDraft(meeting.title || "");
                  setRenaming(true);
                }}
              >
                <span className="flex items-center gap-2">
                  <Pencil className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
                  {t("weekly.actions.rename")}
                </span>
              </CustomMenu.MenuItem>
              {/* 開き間違えた会期の逃げ道。これが無いと確定の押し間違いから戻れなくなる。 */}
              <CustomMenu.MenuItem onClick={() => setDeleteOpen(true)}>
                <span className="flex items-center gap-2 text-danger-primary">
                  <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
                  {t("weekly.actions.delete")}
                </span>
              </CustomMenu.MenuItem>
            </>
          )}
        </CustomMenu>
        )}

        {meeting && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-11 font-medium",
              confirmed ? "bg-success-subtle text-success-primary" : "bg-accent-subtle text-accent-primary"
            )}
          >
            {t(confirmed ? "weekly.status.confirmed" : "weekly.status.open")}
          </span>
        )}
        {meeting && (
          <span className="hidden shrink-0 text-11 tabular-nums text-placeholder sm:inline">
            {fmtDate(meeting.period_start)} – {fmtDate(meeting.period_end)}
          </span>
        )}

        <span className="flex-1" />

        {/* 議事ノート。既にあれば「開く」だけ — 見る人(GUEST 含む)全員に出す。
            無い時は作る導線で、行き先の project は前回のノートを既定にする。 */}
        {notesHref ? (
          <Tooltip tooltipContent={t("weekly.notes.open_hint")} position="bottom">
            <a
              href={notesHref}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-13 font-medium text-secondary transition-colors hover:bg-layer-1 hover:text-primary"
            >
              <NotebookPen className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("weekly.notes.open")}</span>
              <ExternalLink className="size-3 shrink-0 text-tertiary" strokeWidth={1.75} />
            </a>
          </Tooltip>
        ) : canEdit && meeting && lastNotesProject ? (
          <Tooltip tooltipContent={t("weekly.notes.create_hint")} position="bottom">
            <Button
              variant="ghost"
              size="base"
              onClick={() => void createNotes(lastNotesProject)}
              loading={busy === "page"}
              disabled={!!busy}
              prependIcon={<NotebookPen />}
            >
              <span className="hidden sm:inline">{t("weekly.notes.create")}</span>
            </Button>
          </Tooltip>
        ) : canEdit && meeting && joinedProjectIds.length > 0 ? (
          /* 初回だけ行き先を聞く。2 回目以降はこの分岐に来ない(前回を引き継ぐ)。 */
          <CustomMenu
            maxHeight="lg"
            closeOnSelect
            customButton={
              <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-13 font-medium text-secondary transition-colors hover:bg-layer-1 hover:text-primary">
                <NotebookPen className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="hidden sm:inline">{t("weekly.notes.create")}</span>
                <ChevronDown className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
              </span>
            }
          >
            <p className="px-2 pb-1 pt-0.5 text-11 text-tertiary">{t("weekly.notes.pick_project")}</p>
            {joinedProjectIds.map((id) => (
              <CustomMenu.MenuItem key={id} onClick={() => void createNotes(id)}>
                <span className="truncate">{getProjectById(id)?.name || "—"}</span>
              </CustomMenu.MenuItem>
            ))}
          </CustomMenu>
        ) : null}

        {/* 発言は GUEST も出せる(API 側も同じ線引き)。だから canEdit の外に置く。 */}
        <Tooltip tooltipContent={t("weekly.chat.title")} position="bottom">
          <Button
            variant={chatOpen ? "secondary" : "ghost"}
            size="base"
            onClick={() => setChatOpen((v) => !v)}
            disabled={!meeting}
            aria-label={t("weekly.chat.title")}
            prependIcon={<MessagesSquare />}
          >
            <span className="hidden sm:inline">{t("weekly.chat.title")}</span>
          </Button>
        </Tooltip>

        <div className={cn("flex items-center gap-2", !canEdit && "hidden")}>
          {/* 「出処だけ取り直す」は上級操作 — 狭い画面では畳んで、主導線を邪魔しない。 */}
          <Tooltip tooltipContent={t("weekly.actions.refresh_sources_hint")} position="bottom">
            <Button
              variant="ghost"
              size="base"
              className="hidden sm:inline-flex"
              onClick={() => void run("sources")}
              loading={busy === "sources"}
              disabled={!meeting || confirmed || !!busy}
            >
              {t("weekly.actions.refresh_sources")}
            </Button>
          </Tooltip>
          <Tooltip tooltipContent={t("weekly.actions.refresh_hint")} position="bottom">
            <Button
              variant="secondary"
              size="base"
              onClick={() => void run("refresh")}
              disabled={!meeting || confirmed || !!busy}
              prependIcon={<RefreshCw className={cn(busy === "refresh" && "animate-spin")} />}
            >
              <span className="hidden sm:inline">{t("weekly.actions.refresh")}</span>
            </Button>
          </Tooltip>
          {confirmed ? (
            <Button variant="primary" size="base" onClick={() => void run("open")} loading={busy === "open"} prependIcon={<Plus />}>
              {t("weekly.actions.open")}
            </Button>
          ) : (
            /* 終端操作にアイコンだけのボタンを出さない — 押してから意味を知るのが最悪。 */
            <Tooltip tooltipContent={t("weekly.actions.confirm_hint")} position="bottom-right">
              <Button
                variant="primary"
                size="base"
                onClick={() => setConfirmOpen(true)}
                disabled={!meeting || !!busy}
                prependIcon={<CheckCircle2 />}
              >
                {t("weekly.actions.confirm")}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "vertical-scrollbar scrollbar-md min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6",
            /* 発言を開いている間だけ週報列を退かす(常に最大化なので同居しない)。
               unmount はしない — 戻した時にスクロール位置と編集途中のテキストが
               消えるのが最悪だから。 */
            chatOpen && "lg:hidden"
          )}
        >
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
          {/* 確定済みは「書けない」ではなく「なぜ書けないか + 戻し方」を出す。
              ボタンを黙って消すと、壊れた画面にしか見えない。 */}
          {confirmed && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-subtle bg-layer-1 px-3 py-2.5">
              <Lock className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
              <p className="min-w-0 flex-1 text-11 leading-relaxed text-tertiary">{t("weekly.status.frozen_hint")}</p>
              {canEdit && (
                <Button
                  variant="secondary"
                  size="base"
                  onClick={() => void run("reopen")}
                  loading={busy === "reopen"}
                  disabled={!!busy}
                  prependIcon={<Undo2 />}
                >
                  {t("weekly.actions.reopen")}
                </Button>
              )}
            </div>
          )}

          <StatCards entries={entries} />

          {entries.length ? (
            <>
              <div className="lg:hidden">
                <WeeklyMemberStrip entries={entries} activeId={activeEntryId} onSelect={setActiveEntryId} />
              </div>

              <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem] xl:gap-5">
                <aside className="vertical-scrollbar scrollbar-sm sticky top-0 hidden max-h-[calc(100vh-12rem)] overflow-y-auto lg:block">
                  <div className="rounded-lg border border-subtle bg-layer-transparent p-2">
                    <WeeklyMemberRail entries={entries} activeId={activeEntryId} onSelect={setActiveEntryId} />
                  </div>
                </aside>

                <div className="flex min-w-0 flex-col gap-4">
                  {activeEntry ? (
                    <WeeklyEntryPanel
                      key={activeEntry.id}
                      workspaceSlug={workspaceSlug}
                      meetingId={meeting?.id || ""}
                      entry={activeEntry}
                      readOnly={confirmed || !canEdit}
                      busy={!!busy}
                      onRefClick={openPeek}
                      onEntryChange={(e) => patchEntry(e)}
                    />
                  ) : null}
                  {/* 広い画面では右列に出す。狭い画面ではここに畳んで置く。 */}
                  <div className="xl:hidden">
                    <WeeklySources sources={activeEntry?.sources || []} onOpen={openPeek} collapsible />
                  </div>
                </div>

                <aside className="vertical-scrollbar scrollbar-sm sticky top-0 hidden max-h-[calc(100vh-12rem)] overflow-y-auto xl:block">
                  <WeeklySources sources={activeEntry?.sources || []} onOpen={openPeek} />
                </aside>
              </div>
            </>
          ) : isLoading ? (
            <div className="h-40 animate-pulse rounded-lg bg-layer-transparent" />
          ) : (
            <p className="rounded-lg border border-dashed border-subtle px-6 py-10 text-center text-12 text-placeholder">
              {t("weekly.empty.no_entries")}
            </p>
          )}
          </div>
        </div>

        {chatOpen && meeting && (
          /* 画面幅に関わらず常に全面 — ドックと最大化の 2 モードで見た目が
             揺れる方が「発言だけ見たい」を素直に満たすより厄介だった。 */
          <aside
            className={cn(
              /* ヘッダ行 + 本体行の 2 行。本体は minmax(0,1fr) — 中身が何行あっても
                 この行を超えられないので、本体側(weekly-chat)の入力欄が
                 画面外へ押し出されない。flex-col + min-h-0 では上位の連鎖に依存する。 */
              "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-surface-1",
              /* 全面シートは #main-sidebar(z-20)と ExtendedProjectSidebar(z-[21])より
                 上に載せる — 同値だと DOM 順次第で左側がサイドバーに食われる。
                 lg 以上でも static(z-auto)に戻さず relative + z-[22] を維持する:
                 static だとサイドバー側の positioned 要素が上に描かれ得る。 */
              "fixed inset-0 z-[22]",
              "lg:relative lg:inset-auto lg:z-[22] lg:shrink-0 lg:border-l lg:border-subtle",
              "lg:w-full"
            )}
          >
            {/* 全面表示のとき閉じる導線はここしか無い。畳めない画面を作らない。 */}
            <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
              <MessagesSquare className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
              <h3 className="min-w-0 flex-1 truncate text-12 font-medium text-secondary">{t("weekly.chat.title")}</h3>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label={t("weekly.chat.close")}
                className="grid size-6 shrink-0 place-items-center rounded-md text-tertiary transition-colors hover:bg-layer-1"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
            {/* 確定済みの会期は発言も締める — 記録として固定するのが確定の意味。 */}
            <WeeklyChat workspaceSlug={workspaceSlug} meetingId={meeting.id} readOnly={confirmed} />
          </aside>
        )}
      </div>

      <AlertModalCore
        isOpen={confirmOpen}
        variant="primary"
        handleClose={() => setConfirmOpen(false)}
        handleSubmit={() => void run("confirm")}
        isSubmitting={busy === "confirm"}
        title={t("weekly.actions.confirm")}
        content={t("weekly.actions.confirm_modal")}
        primaryButtonText={{ default: t("weekly.actions.confirm"), loading: t("weekly.actions.confirming") }}
        secondaryButtonText={t("weekly.final.cancel")}
      />

      <AlertModalCore
        isOpen={deleteOpen}
        variant="danger"
        handleClose={() => setDeleteOpen(false)}
        handleSubmit={() => void run("delete")}
        isSubmitting={busy === "delete"}
        title={t("weekly.actions.delete")}
        content={t("weekly.actions.delete_modal")}
        primaryButtonText={{ default: t("weekly.actions.delete"), loading: t("weekly.actions.deleting") }}
        secondaryButtonText={t("weekly.final.cancel")}
      />
    </div>
  );
});
