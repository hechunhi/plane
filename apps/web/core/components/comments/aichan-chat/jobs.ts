/**
 * BARSOUL 愛ちゃん私聊 — 後台 job ストア(2026-10-06, hechun「途中で他へ移ったら？後台モードは？」)
 *
 * なぜモジュール級ストアなのか:
 *   以前は返答待ちが React state(パネルの中)にしか無く、パネルを閉じる / 別の課題へ移る /
 *   リロードした瞬間に待ちごと消えていた。待ちは **パネルより長生き** でなければならない。
 *   → job は ai-bot 側に保持(1 時間)し、こちらは job_id を localStorage に置く。
 *     ポーリングはこのモジュールが 1 本だけ回す(パネルが閉じていても、別ページでも)。
 *     返答が届いたら課題ごとのスレッド(use-thread と同じ key)へ書き込む。
 *   → パネルが開いていればその場に出る。閉じていれば右下の dock(dock.tsx)が知らせる。
 *
 * 課題ごとに同時 1 件(会話は順番に進むもの。並行に投げると返答の順が崩れる)。
 * 複数タブ: どのタブが先に受け取っても 1 回だけ追記されるよう、書く直前に storage を読み直す。
 */
import type { TChatTurn } from "./use-thread";

export type TAichanJobStatus = "running" | "done" | "error";

export type TAichanJob = {
  jobId: string;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueTitle?: string;
  /** 送った時に居たページ(pathname+search)。dock から戻る先。 */
  href: string;
  startedAt: number;
  status: TAichanJobStatus;
  /** error のときの種別。"lost" = ai-bot 再起動等で job が消えた。 */
  error?: "lost" | "timeout" | "failed";
};

const JOBS_KEY = "barsoul.aichan.jobs";
export const threadKey = (issueId: string) => `barsoul.aichan.thread:${issueId}`;
/** 履歴は直近 20 ターンまで(use-thread と同じ上限)。 */
export const MAX_TURNS = 20;
/** 云モデル + 兜底链の最悪でも 3 分あれば返る。超えたら諦めて再試行を出す。 */
const JOB_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1500;

type TJobMap = Record<string, TAichanJob>;

const readJobs = (): TJobMap => {
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TJobMap) : {};
  } catch {
    return {};
  }
};

const writeJobs = (jobs: TJobMap) => {
  try {
    if (Object.keys(jobs).length) localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
    else localStorage.removeItem(JOBS_KEY);
  } catch {
    /* localStorage 不可 = 揮発運用に降格 */
  }
  emit();
};

export const readThread = (issueId: string): TChatTurn[] => {
  try {
    const raw = localStorage.getItem(threadKey(issueId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is TChatTurn =>
          !!t &&
          typeof t === "object" &&
          typeof (t as TChatTurn).content === "string" &&
          ((t as TChatTurn).role === "user" || (t as TChatTurn).role === "assistant")
      )
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
};

export const writeThread = (issueId: string, turns: TChatTurn[]) => {
  try {
    if (turns.length) localStorage.setItem(threadKey(issueId), JSON.stringify(turns.slice(-MAX_TURNS)));
    else localStorage.removeItem(threadKey(issueId));
  } catch {
    /* ignore */
  }
};

/* ── 購読(useSyncExternalStore 用) ─────────────────────────────────────── */

const listeners = new Set<() => void>();
let snapshot: TJobMap = {};
let snapshotRaw = "";

function emit() {
  let raw = "";
  try {
    raw = localStorage.getItem(JOBS_KEY) ?? "";
  } catch {
    /* ignore */
  }
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = readJobs();
  }
  listeners.forEach((fn) => fn());
}

export function subscribeJobs(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    emit();
    ensurePolling();
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const onStorage = (e: StorageEvent) => {
  // 別タブがスレッド/ job を更新した → こちらの表示も追従させる
  if (e.key === JOBS_KEY || e.key?.startsWith("barsoul.aichan.thread:")) {
    snapshotRaw = "\u0000"; // 強制再読込(スレッドだけ変わった場合も購読者に知らせる)
    emit();
    ensurePolling();
  }
};

export const getJobsSnapshot = (): TJobMap => snapshot;
export const getServerJobsSnapshot = (): TJobMap => ({});

/* ── 開いているパネル(そこへ直接出るので dock では知らせない) ──────────────── */

const openPanels = new Set<string>();

export function markPanelOpen(issueId: string, open: boolean) {
  if (open) openPanels.add(issueId);
  else openPanels.delete(issueId);
  // 開いた瞬間に「届いています」の札を下ろす(もう目の前に出ている)
  if (open) ackJob(issueId);
  // openPanels は snapshot の外にあるので、参照を作り直して dock を再描画させる
  snapshotRaw = "\u0000";
  emit();
}

export const isPanelOpen = (issueId: string) => openPanels.has(issueId);

/** done の札を下ろす(返答はスレッドに既に書かれている)。 */
export function ackJob(issueId: string) {
  const jobs = readJobs();
  if (jobs[issueId]?.status === "done") {
    delete jobs[issueId];
    writeJobs(jobs);
  }
}

export function dismissJob(issueId: string) {
  const jobs = readJobs();
  if (jobs[issueId]) {
    delete jobs[issueId];
    writeJobs(jobs);
  }
}

/* ── dock → パネル再オープン要求 ─────────────────────────────────────────── */

let reopenIssueId: string | null = null;

export function requestReopen(issueId: string) {
  reopenIssueId = issueId;
  emit();
}

/** comment-create が自分宛ての再オープン要求を受け取る(1 回で消費)。 */
export function consumeReopen(issueId: string): boolean {
  if (reopenIssueId !== issueId) return false;
  reopenIssueId = null;
  return true;
}

/* ── 送信 + ポーリング ───────────────────────────────────────────────────── */

const endpoint = (j: Pick<TAichanJob, "workspaceSlug" | "projectId" | "issueId">) =>
  `/api/workspaces/${j.workspaceSlug}/projects/${j.projectId}/issues/${j.issueId}/ai-approval/`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(body),
  });
  let j: (T & { ok?: boolean; error?: string; msg?: string }) | null = null;
  try {
    j = await r.json();
  } catch {
    /* non-json */
  }
  if (!r.ok || !j?.ok) throw new Error(j?.error || j?.msg || `HTTP ${r.status}`);
  return j;
}

type TStartArgs = Omit<TAichanJob, "jobId" | "startedAt" | "status" | "error"> & {
  lang: string;
  messages: TChatTurn[];
};

/** 後台 job を投げる。返答は待たない(届けるのはポーリング)。 */
export async function startChatJob(args: TStartArgs): Promise<void> {
  const { lang, messages, ...meta } = args;
  const j = await post<{ job_id: string }>(endpoint(meta), {
    action: "chat",
    background: true,
    lang,
    messages,
  });
  const jobs = readJobs();
  jobs[meta.issueId] = { ...meta, jobId: j.job_id, startedAt: Date.now(), status: "running" };
  writeJobs(jobs);
  ensurePolling();
}

let pollTimer: number | null = null;
let polling = false;

export function ensurePolling() {
  if (typeof window === "undefined" || pollTimer !== null) return;
  if (!Object.values(readJobs()).some((j) => j.status === "running")) return;
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    void pollOnce().finally(ensurePolling);
  }, POLL_MS);
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const running = Object.values(readJobs()).filter((j) => j.status === "running");
    await Promise.all(running.map(pollJob));
  } finally {
    polling = false;
  }
}

/** 書く直前に読み直し、同じ job がまだ running の時だけ確定させる(多タブ二重追記の防止)。 */
function settle(job: TAichanJob, patch: Partial<TAichanJob>, reply?: string) {
  const jobs = readJobs();
  const cur = jobs[job.issueId];
  if (!cur || cur.jobId !== job.jobId || cur.status !== "running") return;
  if (reply) writeThread(job.issueId, [...readThread(job.issueId), { role: "assistant" as const, content: reply }]);
  // 返答が目の前のパネルに出るなら札は要らない
  if (patch.status === "done" && openPanels.has(job.issueId)) delete jobs[job.issueId];
  else jobs[job.issueId] = { ...cur, ...patch };
  writeJobs(jobs);
}

async function pollJob(job: TAichanJob) {
  if (Date.now() - job.startedAt > JOB_TIMEOUT_MS) {
    settle(job, { status: "error", error: "timeout" });
    return;
  }
  try {
    const r = await post<{ status: string; reply?: string }>(endpoint(job), {
      action: "chat_poll",
      job_id: job.jobId,
    });
    if (r.status === "done" && r.reply) settle(job, { status: "done" }, r.reply);
    else if (r.status === "not_found") settle(job, { status: "error", error: "lost" });
    else if (r.status === "error" || (r.status === "done" && !r.reply))
      settle(job, { status: "error", error: "failed" });
  } catch {
    /* 一時的なネットワーク断はそのまま次の周期で再試行(timeout が上限) */
  }
}
