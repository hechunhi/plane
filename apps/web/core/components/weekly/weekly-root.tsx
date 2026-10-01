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
  MoreHorizontal,
  NotebookPen,
  AlertTriangle,
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

const DAY = 86400000;

/** 窓の長さ(日)。0 日は無いので下限 1 — 「0 日間」と出る方が壊れて見える。 */
const spanDays = (m: { period_start: string; period_end: string }) => {
  const a = new Date(m.period_start).getTime();
  const b = new Date(m.period_end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(1, Math.round((b - a) / DAY));
};

/** <input type="date"> は YYYY-MM-DD しか受けない。**現地時間で** 切る
 *  (toISOString は UTC なので、日本から見ると前日が出る)。 */
const pad2 = (n: number) => String(n).padStart(2, "0");
const toDateInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * 会期の窓。**日付ラベルではなく操作** として置く(hechun 2026-09-09)。
 *
 * ここが読み取り専用だったせいで、7/24 に開いた会期が確定されないまま 9/3 まで
 * 残り、窓が 47 日に育っていた。period_start を動かせるのは「前の会期を確定する」
 * 時だけ ——確定は会期を凍らせる終端操作なので、会議中にずれに気付いても直す手が
 * 無かった。結果は日付が変なだけでは済まず、1 人の出処が 180 件になって
 * 「今週何をしたか」を読む道具ではなくなる。「週報が使われていない」の実体はこれ。
 *
 * なので (1) 長さを日数で必ず出し、(2) 長過ぎる時は自分から警告し、
 * (3) その場で詰められる様にする。既定値を賢くするだけでは足りない ——
 * 既に育ってしまった会期を人が直せないと、同じ所で詰まったままになる。
 *
 * CustomMenu ではなく素の popover なのは、中に <input> を置くから
 * (headlessui の Menu はキー入力を項目移動として食う)。
 */
function PeriodControl({
  meeting,
  editable,
  lastHeldAt,
  onApply,
  busy,
}: {
  meeting: TWeeklyMeeting;
  editable: boolean;
  /** 直近の確定会議の held_at。「前回の会議から」の起点(無ければその選択肢を出さない)。 */
  lastHeldAt: string | null;
  onApply: (start: string, end: string) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const days = spanDays(meeting);
  // 境目はサーバが配る(long_period_days)。同じ数字を TS 側に書き写さない。
  const tooLong = days > (meeting.long_period_days ?? 10);

  useEffect(() => {
    setStart(toDateInput(meeting.period_start));
    setEnd(toDateInput(meeting.period_end));
  }, [meeting.period_start, meeting.period_end]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const apply = async (s: string, e: string) => {
    await onApply(s, e);
    setOpen(false);
  };
  // 末端は「その日いっぱい」。日付だけを渡すと 0 時で切れて、その日の分が丸ごと落ちる。
  //
  // 送るのは **必ずオフセット付き**(toISOString)。api コンテナは UTC で回っているので、
  // 素の "2026-09-01T00:00:00" を渡すと UTC 0 時 = 日本の朝 9 時として切られ、
  // 選んだ日の午前中が窓から落ちる。ここで現地時間として解いてから UTC に直す。
  const applyInputs = () =>
    start &&
    end &&
    void apply(new Date(`${start}T00:00:00`).toISOString(), new Date(`${end}T23:59:59.999`).toISOString());
  const applyLastDays = (n: number) =>
    void apply(new Date(Date.now() - n * DAY).toISOString(), new Date().toISOString());

  const label = (
    <>
      <span className="tabular-nums">
        {fmtDate(meeting.period_start)} – {fmtDate(meeting.period_end)}
      </span>
      {/* 日数を必ず添える。「7/17 – 9/3」だけだと、何日分を見ているのかが読み取れない
          ——47 日である事に誰も気付かないまま 6 週間使われた。 */}
      <span className={cn("tabular-nums", tooLong ? "font-medium" : "text-placeholder")}>
        {t("weekly.period.days", { count: days })}
      </span>
      {tooLong && <AlertTriangle className="size-3 shrink-0" strokeWidth={2} />}
    </>
  );

  if (!editable)
    return (
      <Tooltip tooltipContent={tooLong ? t("weekly.period.too_long_hint") : t("weekly.period.hint")} position="bottom">
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 text-11 sm:flex",
            tooLong ? "text-warning-primary" : "text-placeholder"
          )}
        >
          {label}
        </span>
      </Tooltip>
    );

  return (
    <div ref={box} className="relative hidden shrink-0 sm:block">
      <Tooltip tooltipContent={tooLong ? t("weekly.period.too_long_hint") : t("weekly.period.hint")} position="bottom">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-11 transition-colors hover:bg-layer-1",
            tooLong ? "text-warning-primary" : "text-placeholder hover:text-secondary"
          )}
        >
          {label}
        </button>
      </Tooltip>

      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-[17rem] rounded-lg border border-subtle bg-surface-2 p-3 shadow-lg">
          <p className="mb-2 text-11 leading-relaxed text-tertiary">
            {tooLong ? t("weekly.period.too_long_hint") : t("weekly.period.hint")}
          </p>

          {/* 詰めるのが一番多い操作なので、押す所を先に置く。長過ぎる時は
              「最近 7 日」を主導線にする —— 詰まった人が読まずに押しても正しい。 */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Button variant={tooLong ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => applyLastDays(7)}>
              {t("weekly.period.last_days", { count: 7 })}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => applyLastDays(14)}>
              {t("weekly.period.last_days", { count: 14 })}
            </Button>
            {lastHeldAt && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void apply(lastHeldAt, new Date().toISOString())}
              >
                {t("weekly.period.since_last")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-subtle bg-layer-transparent px-2 py-1 text-11 text-primary outline-none focus:border-accent-strong"
            />
            <span className="shrink-0 text-11 text-tertiary">–</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-subtle bg-layer-transparent px-2 py-1 text-11 text-primary outline-none focus:border-accent-strong"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 w-full"
            loading={busy}
            disabled={busy || !start || !end || start > end}
            onClick={applyInputs}
          >
            {t("weekly.period.apply")}
          </Button>
          {/* 窓を直すと出処は作り直されるが下書きは作り直さない(1 人 ~70s の直列)。
              黙って古い下書きが残ると誤解を招くので、先に言っておく。 */}
          <p className="mt-2 text-11 leading-relaxed text-tertiary">{t("weekly.period.apply_hint")}</p>
        </div>
      )}
    </div>
  );
}

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

  // 出処パネルの丸と同じ色を使う。同じ意味に別の色を当てない。
  const cards = [
    { key: "done", value: agg.done, dot: "bg-success-primary" },
    { key: "progress", value: agg.progress, dot: "bg-accent-primary" },
    { key: "discussion", value: agg.discussion, dot: "bg-warning-primary" },
  ];

  const remaining = entries.length - agg.confirmed;

  return (
    /* まとめは「読む物」ではなく「一瞥する物」。カード 4 枚で一帯を潰さず、1 行の帯に落とす。
       会議で本当に効くのは下書き本文と出処で、この数字はその上の温度計でしかない。 */
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-subtle bg-layer-transparent px-3.5 py-2">
      {cards.map((c) => (
        <span key={c.key} className="flex shrink-0 items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", c.dot)} />
          <span className="text-15 leading-none font-semibold text-primary tabular-nums">{c.value}</span>
          <span className="text-11 whitespace-nowrap text-tertiary">{t(`weekly.stats.${c.key}`)}</span>
        </span>
      ))}

      <span className="hidden flex-1 sm:block" />

      {/* 定稿の進み具合だけは「見る数字」ではなく「まだ誰か書けていない」の合図。
          だから他の 3 つと切り離して右端に置き、残っている間だけ琥珀で灯す。 */}
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-11 whitespace-nowrap text-tertiary">{t("weekly.stats.confirmed")}</span>
        <span
          className={cn(
            "text-13 leading-none font-semibold tabular-nums",
            remaining > 0 ? "text-warning-primary" : "text-success-primary"
          )}
        >
          {agg.confirmed}/{entries.length}
        </span>
        <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-layer-1 sm:block">
          <span
            className={cn("block h-full rounded-full", remaining > 0 ? "bg-warning-primary" : "bg-success-primary")}
            style={{ width: `${entries.length ? (agg.confirmed / entries.length) * 100 : 0}%` }}
          />
        </span>
      </span>
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

  // force 削除だけは管理者に限る(API 側も同じ線引き)。
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);

  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "sources" | "confirm" | "reopen" | "open" | "delete" | "page" | "period">("");
  // 確定は「会期を閉じる」終端操作。押した瞬間に全員の編集が止まるので、必ず訊く。
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** 409 で返ってきた「何が引っ掛かっているか」。押した後にしか分からない事もあるので
   *  掴んでおいて、モーダルの中で数のまま出す。 */
  const [deleteBlocked, setDeleteBlocked] = useState<{ final_entries: number; chat_messages: number } | null>(null);
  /** 22rem のドックだと長い発言が読めない問題を「常に最大化」で解消。
   *  ドック/最大化のトグルはもう無い — 開けば常にコンテナ内いっぱい。 */
  const [chatOpen, setChatOpen] = useState(false);
  // 会期名。新規会期は無名で始まるので日付だけになる — 会議中に口で指せない。
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const escaped = useRef(false);

  const { data: meetings, mutate: mutateList } = useSWR(workspaceSlug ? ["weekly-meetings", workspaceSlug] : null, () =>
    weeklyService.list(workspaceSlug)
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
  } = useSWR(workspaceSlug && meetingId ? ["weekly-meeting", workspaceSlug, meetingId] : null, () =>
    weeklyService.detail(workspaceSlug, meetingId as string)
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
        // SWR のキャッシュは参照比較で再描画を決めるので、ここは in-place 変更ではなく
        // copy-on-write でなければならない(Object.assign に置き換えると再描画が飛ぶ)。
        (cur?: TWeeklyMeeting) =>
          cur
            ? // oxlint-disable-next-line no-map-spread
              { ...cur, entries: (cur.entries || []).map((e) => (e.id === targetId ? { ...e, ...next } : e)) }
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
        // 阻まれると分かっている時だけ force を付ける。既定は今まで通り「空の会期しか
        // 消せない」で、force は **管理者が中身を見た上で** 押した時にだけ立つ。
        await weeklyService.remove(workspaceSlug, gone as string, { force: forceDelete });
        const rest = await mutateList();
        setDeleteOpen(false);
        setDeleteBlocked(null);
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
      const res = (err as { response?: { status?: number; data?: { counts?: typeof deleteBlocked } } })?.response;
      const conflict = res?.status === 409;
      // 削除が阻まれた時は数を掴んでモーダルに残す。「消せません」だけ言われて
      // 何が引っ掛かっているかも分からない、が 6 週間続いた失敗の形。
      if (conflict && kind === "delete") setDeleteBlocked(res?.data?.counts ?? null);
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

  /**
   * 窓を直す。返るのは投影を作り直した後の会期(entries 入り)なので丸ごと差し替える。
   * 下書きは作り直されない — 必要なら「作り直す」を押す(生成は 1 人 ~70s の直列で、
   * 窓をつまむ度に数分待たされるのでは誰も直さなくなる)。
   */
  const savePeriod = async (period_start: string, period_end: string) => {
    if (!meeting) return;
    setBusy("period");
    try {
      const next = await weeklyService.patch_(workspaceSlug, meeting.id, { period_start, period_end });
      void mutateMeeting(next as TWeeklyMeeting, { revalidate: false });
      await mutateList();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("weekly.period.updated") });
    } catch (err) {
      const conflict = (err as { response?: { status?: number } })?.response?.status === 409;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t(conflict ? "weekly.period.frozen" : "weekly.actions.failed"),
      });
    } finally {
      setBusy("");
    }
  };

  const confirmed = meeting?.status === "CONFIRMED";
  // 「前回の会議から」の起点。確定済みで一番新しいもの(一覧は period_end の降順)。
  const lastHeldAt = useMemo(
    () => (meetings || []).find((m) => m.id !== meeting?.id && m.held_at)?.held_at ?? null,
    [meetings, meeting?.id]
  );
  // 押す前に分かる分は先に出す(GET detail が counts を配る)。押して初めて
  // 分かった分(409 の本文)は deleteBlocked に入るので、どちらかを使う。
  const blockers = deleteBlocked ?? meeting?.counts ?? null;
  const willBlock = !!blockers && (blockers.final_entries > 0 || blockers.chat_messages > 0);
  const forceDelete = willBlock && isAdmin;

  if (!meetings) return <div className="h-full animate-pulse bg-layer-transparent" />;

  if (!meetings.length)
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <CalendarDays className="size-8 text-tertiary" strokeWidth={1.25} />
          <h2 className="text-16 font-semibold text-primary">{t("weekly.empty.title")}</h2>
          <p className="text-12 leading-relaxed text-tertiary">{t("weekly.empty.hint")}</p>
          {canEdit && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => void run("open")}
              loading={busy === "open"}
              prependIcon={<Plus />}
            >
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
            // autoFocus は a11y 規則で禁止。改名は明示的に押して入るモードなので
            // 「開いた瞬間にキャレットが入る」挙動は変えず、mount 時に ref で当てる。
            ref={(el) => {
              if (el && document.activeElement !== el) el.focus();
            }}
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
                  {meeting?.title ||
                    (meeting ? `${fmtDate(meeting.period_start)} – ${fmtDate(meeting.period_end)}` : "—")}
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
          <PeriodControl
            meeting={meeting}
            /* 確定済みの窓は記録なので動かさない(API も 409 を返す)。 */
            editable={canEdit && !confirmed}
            lastHeldAt={lastHeldAt}
            onApply={savePeriod}
            busy={busy === "period"}
          />
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
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-13 font-medium whitespace-nowrap text-secondary transition-colors hover:bg-layer-1 hover:text-primary"
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
              className="shrink-0 whitespace-nowrap"
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
              <span className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-13 font-medium whitespace-nowrap text-secondary transition-colors hover:bg-layer-1 hover:text-primary">
                <NotebookPen className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="hidden sm:inline">{t("weekly.notes.create")}</span>
                <ChevronDown className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
              </span>
            }
          >
            <p className="px-2 pt-0.5 pb-1 text-11 text-tertiary">{t("weekly.notes.pick_project")}</p>
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
            className="shrink-0 whitespace-nowrap"
          >
            <span className="hidden sm:inline">{t("weekly.chat.title")}</span>
          </Button>
        </Tooltip>

        {/* 「見る操作」と「会期を動かす操作」の境目。5 つ並べると全部同じ重さに見えて、
            終端操作の 確定 が主導線として読めなくなる。 */}
        <span className={cn("mx-0.5 h-4 w-px shrink-0 bg-[var(--border-color-subtle)]", !canEdit && "hidden")} />

        <div className={cn("flex shrink-0 items-center gap-2", !canEdit && "hidden")}>
          <Tooltip tooltipContent={t("weekly.actions.refresh_hint")} position="bottom">
            <Button
              variant="secondary"
              size="base"
              onClick={() => void run("refresh")}
              disabled={!meeting || confirmed || !!busy}
              prependIcon={<RefreshCw className={cn(busy === "refresh" && "animate-spin")} />}
              className="shrink-0 whitespace-nowrap"
            >
              <span className="hidden sm:inline">{t("weekly.actions.refresh")}</span>
            </Button>
          </Tooltip>
          {confirmed ? (
            <Button
              variant="primary"
              size="base"
              onClick={() => void run("open")}
              loading={busy === "open"}
              prependIcon={<Plus />}
              className="shrink-0 whitespace-nowrap"
            >
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
                className="shrink-0 whitespace-nowrap"
              >
                {t("weekly.actions.confirm")}
              </Button>
            </Tooltip>
          )}

          {/* 「出処だけ取り直す」は上級操作。平置きすると主導線と同じ重さに見えるので畳む。 */}
          <CustomMenu
            closeOnSelect
            placement="bottom-end"
            customButton={
              <span className="grid size-7 shrink-0 place-items-center rounded-md text-tertiary transition-colors hover:bg-layer-1 hover:text-primary">
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </span>
            }
          >
            <CustomMenu.MenuItem disabled={!meeting || confirmed || !!busy} onClick={() => void run("sources")}>
              <span className="flex items-center gap-2">
                <RefreshCw
                  className={cn("size-3.5 shrink-0 text-tertiary", busy === "sources" && "animate-spin")}
                  strokeWidth={1.75}
                />
                <span className="whitespace-nowrap">{t("weekly.actions.refresh_sources")}</span>
              </span>
            </CustomMenu.MenuItem>
            <p className="max-w-[15rem] px-2 pt-0.5 pb-1 text-11 leading-relaxed text-tertiary">
              {t("weekly.actions.refresh_sources_hint")}
            </p>
          </CustomMenu>
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
                  <aside className="vertical-scrollbar sticky top-0 hidden scrollbar-sm max-h-[calc(100vh-12rem)] overflow-y-auto lg:block">
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

                  <aside className="vertical-scrollbar sticky top-0 hidden scrollbar-sm max-h-[calc(100vh-12rem)] overflow-y-auto xl:block">
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
              /* BARSOUL(2026-07-27): 断点排他。素の `fixed` + `lg:relative` にはしない —
                 拡張機能が挿す CSS(origin: injected)の `.fixed{position:fixed}` は
                 ページ側の @layer utilities より強く、lg でも position:fixed のまま
                 残る。そうなると aside は flow から外れて高さが青天井になり、
                 grid の minmax(0,1fr) が「中身の高さ」で決まる → 一覧が伸びて
                 入力欄が画面外に落ちる(発言が増えた会議中に実際に踏んだ)。
                 profile/sidebar.tsx の max-md:fixed と同じ手当て — 断点で
                 排他にすれば `.fixed` 自体を使わないので上書き合戦が起きない。 */
              "relative z-[22] max-lg:fixed max-lg:inset-0",
              "lg:w-full lg:shrink-0 lg:border-l lg:border-subtle"
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

      {/* 削除。**押す前に** 何が引っ掛かるかを数で出す(hechun 2026-09-09)。
          以前はここが静的な一文で、押して初めて「定稿か発言があるので消せません」と
          言われ、何が・幾つ引っ掛かっているかも、どうすれば消せるかも出せなかった。
          実際に詰まっていたのは 6 週間前の定稿 1 本と 5 分の疎通確認 17 件で、
          その二つの為に会期が消せないまま週報機能そのものが使われなくなった。 */}
      <AlertModalCore
        isOpen={deleteOpen}
        variant="danger"
        handleClose={() => {
          setDeleteOpen(false);
          setDeleteBlocked(null);
        }}
        handleSubmit={() => void run("delete")}
        isSubmitting={busy === "delete"}
        /* 管理者でも無いのに「それでも削除」は出さない。押せない物を押せる形で見せない。 */
        isSubmitDisabled={willBlock && !isAdmin}
        title={t("weekly.actions.delete")}
        content={
          <span className="block">
            <span className="block">{t("weekly.actions.delete_modal")}</span>
            {willBlock && blockers && (
              <span className="mt-2 block rounded-md border border-subtle bg-layer-1 px-2.5 py-2 text-11 leading-relaxed text-secondary">
                <span className="block font-medium text-primary">{t("weekly.actions.delete_blocked_title")}</span>
                {blockers.final_entries > 0 && (
                  <span className="block tabular-nums">
                    {t("weekly.actions.delete_blocked_entries", { count: blockers.final_entries })}
                  </span>
                )}
                {blockers.chat_messages > 0 && (
                  <span className="block tabular-nums">
                    {t("weekly.actions.delete_blocked_chat", { count: blockers.chat_messages })}
                  </span>
                )}
                <span className="mt-1.5 block text-tertiary">
                  {t(isAdmin ? "weekly.actions.delete_force_hint" : "weekly.actions.delete_blocked_hint")}
                </span>
              </span>
            )}
          </span>
        }
        primaryButtonText={{
          default: t(forceDelete ? "weekly.actions.delete_force" : "weekly.actions.delete"),
          loading: t("weekly.actions.deleting"),
        }}
        secondaryButtonText={t("weekly.final.cancel")}
      />
    </div>
  );
});
