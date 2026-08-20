/**
 * BARSOUL 2026-08 — 通知 → 活動フィード内アンカーの解決。
 *
 * 活動フィードの各行は `id="ac-<id>"` を持つ(activity-comment-root.tsx)。
 *   - コメントカード  → `ac-<コメント id>`
 *   - それ以外の活動  → `ac-<活動 id>`
 *
 * そして通知の `data.issue_activity` では:
 *   - `issue_comment`   … **コメント本文のテキスト**(id ではない)
 *   - `new_identifier`  … コメント活動の場合の **コメント id**
 *   - `id`              … 活動 id
 *
 * 過去に `issue_comment` を id として使っていたためコメント通知の
 * スクロール定位が常に外れていた。解決は必ずこの関数を通すこと。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TAnchorSource =
  | {
      id?: string | undefined;
      field?: string | undefined;
      new_identifier?: string | null | undefined;
    }
  | undefined
  | null;

export const getNotificationAnchorId = (activity: TAnchorSource): string | undefined => {
  if (!activity) return undefined;
  const candidates: (string | null | undefined)[] =
    activity.field === "comment" ? [activity.new_identifier, activity.id] : [activity.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && UUID_RE.test(candidate)) return candidate;
  }
  return undefined;
};
