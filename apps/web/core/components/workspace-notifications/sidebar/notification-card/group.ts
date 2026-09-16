/**
 * BARSOUL 2026-09-16 (hechun) — 通知の流れを「カード単位」に畳む純関数。
 *
 * 動機: 動態は素の activity log で、1 画面 28 行が実は 4 枚のカードだった。
 *   - 同じコメントの編集が 2〜5 回並ぶ(編集ごとに通知が立つ)
 *   - 同じ人の連続した 添付 / 改名 / 項目変更 が 1 行ずつ
 *   - どの行が同じカードかを目で束ねる必要がある
 *
 * ここでやる事(全て表示側の投影。通知の保存・既読の意味は変えない):
 *   1. 同一コメント(new_identifier)の編集通知は最新 1 件だけ残す
 *   2. 連続した「同じ人 × 同じカード × 同じ field」を 1 行に束ねる(添付 3 件 等)
 *   3. 連続した同一カードの通知を 1 グループにする(時系列は崩さない)
 *   4. 日付でセクションを切る(今日 / 昨日 / それ以前)
 *
 * 畳まれた側の通知 id は `hiddenIds` に残す — クリックで既読にする時に
 * 一緒に既読へ倒さないと未読数が永遠に減らない。
 */
import type { TNotification } from "@plane/types";

/** 束ねて良い field。コメント / 状態 / 担当者 は 1 件ずつ意味があるので束ねない。 */
const BATCHABLE_FIELDS = new Set(["attachment", "name", "description", "link", "labels"]);

export type TNotificationRow = {
  /** 代表通知(最新)。描画・クリック・既読はこれを使う。 */
  id: string;
  notification: TNotification;
  /** 同じ行に畳まれた通知の id(代表を除く)。既読にする時に一緒に倒す。 */
  hiddenIds: string[];
  /** 束ねた件数(代表を含む)。1 なら通常行。 */
  batchSize: number;
  unread: boolean;
  /**
   * コメントが投稿から 5 分以上経って編集された時だけ true。
   * 投稿直後の直し(誤字・改行)は「編集」と呼ぶほどの情報が無い —
   * 実データでは 9 割のコメントが 1 分以内に一度 update されるので、
   * 全部に「已编辑」を付けると印が意味を失う。
   */
  editedLate: boolean;
};

const LATE_EDIT_MS = 5 * 60 * 1000;
const timeOf = (n: TNotification) => {
  const t = n.created_at ? new Date(n.created_at).getTime() : NaN;
  return Number.isFinite(t) ? t : undefined;
};

export type TNotificationGroup = {
  key: string;
  issueId: string | undefined;
  projectId: string | undefined;
  identifier: string;
  name: string;
  rows: TNotificationRow[];
  unreadCount: number;
  /** グループ内の最新時刻(ISO)。セクション分けに使う。 */
  latestAt: string | undefined;
};

export type TNotificationSectionKey = "today" | "yesterday" | "week" | "older";

export type TNotificationSection = {
  key: TNotificationSectionKey;
  groups: TNotificationGroup[];
};

const activityOf = (n: TNotification) => n.data?.issue_activity;
const kindOf = (n: TNotification) => (n.data as { kind?: string } | undefined)?.kind;
const isUnread = (n: TNotification) => n.read_at === null || n.read_at === undefined;

/** 1. + 2.: 編集の重複を落とし、連続する同種の行を束ねる。入力は新しい順。 */
export const collapseNotifications = (notifications: TNotification[]): TNotificationRow[] => {
  const rows: TNotificationRow[] = [];
  // 同一コメントは最初(=最新)に見えた 1 件が代表。
  const commentRowByCommentId = new Map<string, TNotificationRow>();

  for (const n of notifications) {
    const act = activityOf(n);
    const issueId = n.data?.issue?.id;

    if (act?.field === "comment" && act.new_identifier) {
      const seen = commentRowByCommentId.get(act.new_identifier);
      if (seen) {
        seen.hiddenIds.push(n.id);
        seen.unread = seen.unread || isUnread(n);
        // 入力は新しい順なので、ここで見える n は代表より古い = 初稿側。
        const latest = timeOf(seen.notification);
        const earlier = timeOf(n);
        if (latest !== undefined && earlier !== undefined && latest - earlier >= LATE_EDIT_MS) seen.editedLate = true;
        continue;
      }
      const row: TNotificationRow = {
        id: n.id,
        notification: n,
        hiddenIds: [],
        batchSize: 1,
        unread: isUnread(n),
        editedLate: false,
      };
      commentRowByCommentId.set(act.new_identifier, row);
      rows.push(row);
      continue;
    }

    const prev = rows[rows.length - 1];
    const prevAct = prev ? activityOf(prev.notification) : undefined;
    if (
      prev &&
      act?.field &&
      BATCHABLE_FIELDS.has(act.field) &&
      prevAct?.field === act.field &&
      prevAct.verb === act.verb &&
      prev.notification.data?.issue?.id === issueId &&
      prev.notification.triggered_by === n.triggered_by &&
      kindOf(prev.notification) === undefined &&
      kindOf(n) === undefined
    ) {
      prev.hiddenIds.push(n.id);
      prev.batchSize += 1;
      prev.unread = prev.unread || isUnread(n);
      continue;
    }

    rows.push({ id: n.id, notification: n, hiddenIds: [], batchSize: 1, unread: isUnread(n), editedLate: false });
  }
  return rows;
};

/**
 * 3.: 連続する同一カードを 1 グループに。
 * グループ同士は新しい順(上が最新)のまま。**グループ内だけ古い→新しい**に並べ直す —
 * Slack のスレッドと同じで、上から読めば会話の流れになる(産品決定 2026-09-16)。
 */
export const groupRowsByIssue = (rows: TNotificationRow[]): TNotificationGroup[] => {
  const groups: TNotificationGroup[] = [];
  for (const row of rows) {
    const issue = row.notification.data?.issue;
    const issueId = issue?.id;
    const last = groups[groups.length - 1];
    if (last && issueId && last.issueId === issueId) {
      last.rows.push(row);
      if (row.unread) last.unreadCount += 1;
      continue;
    }
    groups.push({
      key: row.id,
      issueId,
      projectId: row.notification.project,
      identifier: issue?.identifier && issue?.sequence_id ? `${issue.identifier}-${issue.sequence_id}` : "",
      name: issue?.name ?? "",
      rows: [row],
      unreadCount: row.unread ? 1 : 0,
      latestAt: row.notification.created_at,
    });
  }
  for (const g of groups) g.rows.reverse();
  return groups;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const sectionKeyOf = (iso: string | undefined, now: Date = new Date()): TNotificationSectionKey => {
  if (!iso) return "older";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "older";
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  if (t >= today) return "today";
  if (t >= today - day) return "yesterday";
  if (t >= today - 6 * day) return "week";
  return "older";
};

/** 4.: 日付セクション。グループの最新時刻で振り分ける(グループは跨がせない)。 */
export const sectionGroups = (groups: TNotificationGroup[], now: Date = new Date()): TNotificationSection[] => {
  const sections: TNotificationSection[] = [];
  for (const g of groups) {
    const key = sectionKeyOf(g.latestAt, now);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.groups.push(g);
    else sections.push({ key, groups: [g] });
  }
  return sections;
};

export const buildNotificationSections = (notifications: TNotification[], now: Date = new Date()) =>
  sectionGroups(groupRowsByIssue(collapseNotifications(notifications)), now);
