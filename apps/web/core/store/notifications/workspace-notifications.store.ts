/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy, isEmpty, update, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TNotificationTab } from "@plane/constants";
import { ENotificationTab, ENotificationLoader, ENotificationQueryParamType } from "@plane/constants";
import type {
  TNotification,
  TNotificationFilter,
  TNotificationLite,
  TNotificationPaginatedInfo,
  TNotificationPaginatedInfoQueryParams,
  TUnreadNotificationsCount,
} from "@plane/types";
// helpers
import { convertToEpoch } from "@plane/utils";
// services
import workspaceNotificationService from "@/services/workspace-notification.service";
// store
import type { INotification } from "@/store/notifications/notification";
import { Notification } from "@/store/notifications/notification";
import type { CoreRootStore } from "@/store/root.store";

type TNotificationLoader = ENotificationLoader | undefined;
type TNotificationQueryParamType = ENotificationQueryParamType;

// BARSOUL A1: カード未読インジケータの「種別」。優先度: mention > assigned
// > comment > update（"対応必須" ほど強い表現にする）。none = 未読なし。
export type TUnreadKind = "mention" | "assigned" | "comment" | "update" | "reminder" | "none";

/**
 * BARSOUL: 未読通知1件の「種別」判定（単一の真実）。
 * unreadKindByIssueId（カード未読バッジ）と actionRequiredUnreadCount
 * （サイドバー行動バッジ）が共用し、分類ロジックのドリフトを防ぐ。
 *   reminder … data.kind === "reminder"（提醒）
 *   mention  … is_mentioned_notification（@あなた宛）
 *   assigned … field === "assignees"（担当指定＝審批指派卡も含む）
 *   comment  … field === "comment"（新コメント＝知会）
 *   update   … その他（状態/ラベル等の軽微な更新＝知会）
 */
export const classifyUnreadKind = (n: INotification): Exclude<TUnreadKind, "none"> => {
  const field = n.data?.issue_activity?.field;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (n.data as any)?.kind === "reminder"
    ? "reminder"
    : n.is_mentioned_notification
      ? "mention"
      : field === "assignees"
        ? "assigned"
        : field === "comment"
          ? "comment"
          : "update";
};

export interface IWorkspaceNotificationStore {
  // observables
  loader: TNotificationLoader;
  unreadNotificationsCount: TUnreadNotificationsCount;
  notifications: Record<string, INotification>; // notification_id -> notification
  currentNotificationTab: TNotificationTab;
  currentSelectedNotificationId: string | undefined;
  paginationInfo: Omit<TNotificationPaginatedInfo, "results"> | undefined;
  filters: TNotificationFilter;
  // computed
  // computed functions
  notificationIdsByWorkspaceId: (workspaceId: string) => string[] | undefined;
  notificationLiteByNotificationId: (notificationId: string | undefined) => TNotificationLite;
  // BARSOUL: 卡片未读バッジ用
  unreadCountByIssueId: (issueId: string | undefined) => number;
  unreadKindByIssueId: (issueId: string | undefined) => TUnreadKind;
  unreadHasReminderByIssueId: (issueId: string | undefined) => boolean;
  unreadCountForIssueIds: (issueIds: string[]) => number;
  unreadProjectIdSet: Set<string>;
  // BARSOUL: サイドバー「収件箱」行動バッジ = 行動が要る未読のみの件数
  actionRequiredUnreadCount: number;
  ensureBadgeNotifications: (workspaceSlug: string) => void;
  refreshBadgeNotifications: (workspaceSlug: string) => Promise<void>;
  markIssueNotificationsAsRead: (workspaceSlug: string, issueId: string | undefined) => Promise<void>;
  firstUnreadActivityTarget: (issueId: string | undefined) => string | undefined;
  // helper actions
  mutateNotifications: (notifications: TNotification[]) => void;
  updateFilters: <T extends keyof TNotificationFilter>(key: T, value: TNotificationFilter[T]) => void;
  updateBulkFilters: (filters: Partial<TNotificationFilter>) => void;
  // actions
  setCurrentNotificationTab: (tab: TNotificationTab) => void;
  setCurrentSelectedNotificationId: (notificationId: string | undefined) => void;
  setUnreadNotificationsCount: (type: "increment" | "decrement", newCount?: number) => void;
  getUnreadNotificationsCount: (workspaceSlug: string) => Promise<TUnreadNotificationsCount | undefined>;
  getNotifications: (
    workspaceSlug: string,
    loader?: TNotificationLoader,
    queryCursorType?: TNotificationQueryParamType
  ) => Promise<TNotificationPaginatedInfo | undefined>;
  markAllNotificationsAsRead: (workspaceId: string) => Promise<void>;
}

export class WorkspaceNotificationStore implements IWorkspaceNotificationStore {
  // constants
  paginatedCount = 300;
  // observables
  loader: TNotificationLoader = undefined;
  unreadNotificationsCount: TUnreadNotificationsCount = {
    total_unread_notifications_count: 0,
    mention_unread_notifications_count: 0,
  };
  notifications: Record<string, INotification> = {};
  // BARSOUL: lodash set() で新キー追加時 MobX は変化を検知しないため、
  // mutateNotifications の else 分岐で必ずインクリメント。
  // computedFn がこれを購読することで新着通知到着時に再評価される。
  _notifUpdateSeq = 0;
  currentNotificationTab: TNotificationTab = ENotificationTab.ALL;
  currentSelectedNotificationId: string | undefined = undefined;
  paginationInfo: Omit<TNotificationPaginatedInfo, "results"> | undefined = undefined;
  filters: TNotificationFilter = {
    type: {
      assigned: false,
      created: false,
      subscribed: false,
    },
    snoozed: false,
    archived: false,
    read: false,
  };
  // BARSOUL: カードバッジ先読み済みワークスペース（非リアクティブな単純ガード）
  // 初回 mount で一度だけ ALL+MENTIONS の prefetch を走らせる用. それ以降の
  // 更新は ADR-033 の SSE(/__rt/stream) + ADR-028 の自適応 safety interval
  // (healthy 5min / degraded 30s / 不可視 0) が realtime-sync.tsx で完結
  // — 本 store 側に追加 polling は持たない(ADR-028 性能配慮設計の遵守).
  private _badgeWS: Set<string> = new Set();
  // BARSOUL: 増分フェッチ用タイムスタンプ. 最後の badge refresh 開始時刻を保持し、
  // 次回 refresh では `since` パラメータとしてバックエンドに渡す. null = 初回フル fetch.
  // _badgeWS と同様に非リアクティブ (makeObservable 外).
  private _lastBadgeFetchAt: string | null = null;

  constructor(protected store: CoreRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      unreadNotificationsCount: observable,
      notifications: observable,
      currentNotificationTab: observable.ref,
      currentSelectedNotificationId: observable,
      paginationInfo: observable,
      filters: observable,
      _notifUpdateSeq: observable.ref,
      // computed
      // helper actions
      setCurrentNotificationTab: action,
      setCurrentSelectedNotificationId: action,
      setUnreadNotificationsCount: action,
      mutateNotifications: action,
      updateFilters: action,
      updateBulkFilters: action,
      // actions
      getUnreadNotificationsCount: action,
      getNotifications: action,
      markAllNotificationsAsRead: action,
      markIssueNotificationsAsRead: action,
    });
  }

  // computed

  // computed functions
  /**
   * @description get notification ids by workspace id
   * @param { string } workspaceId
   */
  notificationIdsByWorkspaceId = computedFn((workspaceId: string) => {
    if (!workspaceId || isEmpty(this.notifications)) return undefined;
    const workspaceNotifications = orderBy(
      Object.values(this.notifications || []),
      (n) => convertToEpoch(n.created_at),
      ["desc"]
    );
    const workspaceNotificationIds = workspaceNotifications
      .filter((n) => n.workspace === workspaceId)
      .filter((n) =>
        this.currentNotificationTab === ENotificationTab.MENTIONS
          ? n.is_mentioned_notification
          : !n.is_mentioned_notification
      )
      .filter((n) => {
        if (!this.filters.archived && !this.filters.snoozed) {
          if (n.archived_at) {
            return false;
          } else if (n.snoozed_till) {
            return false;
          } else {
            return true;
          }
        } else {
          if (this.filters.snoozed) {
            return !!n.snoozed_till;
          } else if (this.filters.archived) {
            return !!n.archived_at;
          } else {
            return true;
          }
        }
      })
      // .filter((n) => (this.filters.read ? (n.read_at ? true : false) : n.read_at ? false : true))
      .map((n) => n.id);
    return workspaceNotificationIds;
  });

  /**
   * @description get notification lite by notification id
   * @param { string } notificationId
   */
  notificationLiteByNotificationId = computedFn((notificationId: string | undefined) => {
    if (!notificationId) return {} as TNotificationLite;
    const { workspaceSlug } = this.store.router;
    const notification = this.notifications[notificationId];
    if (!notification || !workspaceSlug) return {} as TNotificationLite;
    return {
      workspace_slug: workspaceSlug,
      project_id: notification.project,
      notification_id: notification.id,
      issue_id: notification.data?.issue?.id,
      is_inbox_issue: notification.is_inbox_issue || false,
    };
  });

  /**
   * BARSOUL: 指定 issue の未読通知数（卡片红点/数字バッジ用）。
   * 通知中心と同一ロジック: 未読(read_at空) かつ 未アーカイブ かつ 未スヌーズ。
   * data.issue.id / entity_identifier 両方で照合（tab には依存しない＝
   * カードは全未読を見せたいので意図的）。
   */
  unreadCountByIssueId = computedFn((issueId: string | undefined): number => {
    // BARSOUL 重要: notifications は plain observable で、mutateNotifications が
    // lodash set で新キーを足すため Object.values 監視では「新着通知の追加」に
    // 再評価が走らない（通知中心は loader/paginationInfo の変化で巻き込まれて
    // 再描画されるだけ）。バッジは独立なので、毎フェッチ/既読で必ず変わる
    // unreadNotificationsCount を読んでリアクティブ依存を確立する（副作用で
    // 「既読にしたら自動で消える」も成立: 既読時 setUnreadNotificationsCount
    // が走るため）。
    void this.unreadNotificationsCount.total_unread_notifications_count;
    void this._notifUpdateSeq;
    if (!issueId || isEmpty(this.notifications)) return 0;
    let count = 0;
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      const nIssueId = n.data?.issue?.id || n.entity_identifier;
      if (nIssueId !== issueId) continue;
      if (n.read_at) continue;
      if (n.archived_at) continue;
      if (n.snoozed_till) continue;
      count++;
    }
    return count;
  });

  /**
   * BARSOUL A1: 指定 issue の未読の「主種別」。複数あれば優先度最大を採用
   * （mention > assigned > comment > update）。バッジの形/色強度を分ける。
   */
  unreadKindByIssueId = computedFn((issueId: string | undefined): TUnreadKind => {
    void this.unreadNotificationsCount.total_unread_notifications_count;
    void this._notifUpdateSeq;
    if (!issueId || isEmpty(this.notifications)) return "none";
    const rank: Record<Exclude<TUnreadKind, "none">, number> = {
      mention: 5,
      assigned: 4,
      comment: 3,
      update: 2,
      reminder: 1, // 最低優先度 — 非提醒未読があれば必ずそちらが勝つ
    };
    let best = 0;
    let bestKind: TUnreadKind = "none";
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      const nIssueId = n.data?.issue?.id || n.entity_identifier;
      if (nIssueId !== issueId || n.read_at || n.archived_at || n.snoozed_till) continue;
      const kind = classifyUnreadKind(n);
      if (rank[kind] > best) {
        best = rank[kind];
        bestKind = kind;
      }
    }
    return bestKind;
  });

  /**
   * BARSOUL A2: 複数 issue（看板の1カラム）の未読合計。列ヘッダ集計用。
   */
  unreadCountForIssueIds = computedFn((issueIds: string[]): number => {
    void this.unreadNotificationsCount.total_unread_notifications_count;
    void this._notifUpdateSeq;
    // BARSOUL 2026-06-08 (hechun): sub-group 看板では groupIssueIds が配列でなく
    // {subGroupId: string[]} の **object** になり、`.length===0` を素通り → new Set(object)
    // が "not iterable" で看板全体をクラッシュさせていた。Array.isArray で堅牢化
    // (非配列は未読 0 で穏当に退避、クラッシュさせない)。
    if (!Array.isArray(issueIds) || issueIds.length === 0 || isEmpty(this.notifications)) return 0;
    const idSet = new Set(issueIds);
    let count = 0;
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      const nIssueId = n.data?.issue?.id || n.entity_identifier;
      if (!nIssueId || !idSet.has(nIssueId)) continue;
      if (n.read_at || n.archived_at || n.snoozed_till) continue;
      count++;
    }
    return count;
  });

  /**
   * BARSOUL A3: 指定 issue に未読の「提醒」通知があるか。
   * unreadKindByIssueId とは独立に判定し「未読+提醒 同時」の both-case に対応。
   */
  unreadHasReminderByIssueId = computedFn((issueId: string | undefined): boolean => {
    void this.unreadNotificationsCount.total_unread_notifications_count;
    void this._notifUpdateSeq;
    if (!issueId || isEmpty(this.notifications)) return false;
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      const nIssueId = n.data?.issue?.id || n.entity_identifier;
      if (nIssueId !== issueId || n.read_at || n.archived_at || n.snoozed_till) continue;
      if ((n.data as any)?.kind === "reminder") return true;
    }
    return false;
  });

  /**
   * BARSOUL(2026-05-25): サイドバー赤点用 — 未読が存在するプロジェクト ID 集合。
   * 「項目→BARSOUL→工作項」のパンくず各レベルに red dot を出すための計算源。
   * 通知 store の未読(read_at=未, archived/snoozed=未)を project ごとに集約。
   */
  get unreadProjectIdSet(): Set<string> {
    void this.unreadNotificationsCount.total_unread_notifications_count;
    void this._notifUpdateSeq;
    const s = new Set<string>();
    if (isEmpty(this.notifications)) return s;
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      if (n.read_at || n.archived_at || n.snoozed_till) continue;
      const pid = (n as any).project;
      if (pid) s.add(String(pid));
    }
    return s;
  }

  /**
   * BARSOUL(2026-07-07 · feat/inbox-action-count): サイドバー「収件箱」バッジの件数。
   *
   * redesign「Inbox = 決策隊列」の分类模型に従い、**行動が要る未読のみ**を数える:
   *   kind ∈ {mention（@あなた宛）, assigned（担当指定＝審批指派卡含む）, reminder（提醒）}。
   * comment / update は「知会」なのでバッジに数えない ＝ 数字を「本当に自分が
   * 動く件数」に一致させ、角标=噪音 を解消する（従来は total_unread を表示していた）。
   *
   * 完全性は既存カードバッジ（unreadCountByIssueId 等）と同一 store（直近~300件）に
   * 依拠。>300 未読という稀ケースでは下界を穏当に示す（クラッシュしない）。
   * 逾期(overdue) は通知種別でなくここでは数えない（別ビュー「今日/逾期」の担当）。
   * 読取投影のみ・SoR 不変更。
   */
  get actionRequiredUnreadCount(): number {
    void this.unreadNotificationsCount.total_unread_notifications_count;
    void this._notifUpdateSeq;
    if (isEmpty(this.notifications)) return 0;
    let count = 0;
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      if (n.read_at || n.archived_at || n.snoozed_till) continue;
      const kind = classifyUnreadKind(n);
      if (kind === "mention" || kind === "assigned" || kind === "reminder") count++;
    }
    return count;
  }

  /**
   * BARSOUL: カードバッジ用に通知を先読み（ワークスペース単位、idempotent）。
   *
   * Plane 後端 (apiserver notification/base.py L100-103) は ALL タブで
   * sender__icontains="mentioned" を EXCLUDE する仕様。
   * → ALL タブの fetch だけだと @mention 通知が一切 store に入らず、
   *   @mention のみで unread になっている課題カード(例: BS-175) は
   *   永遠に既読扱いになる。
   *
   * 解決: badge 用途では ALL + MENTIONS の二重 fetch を行い、両方を
   * mutateNotifications で merge(set 操作は同 id を上書き、新規は追加)。
   * 通知中心 UI の tab state(currentNotificationTab/filters/pagination) は
   * 一切触らない — 直接 service を呼び、store の notifications 観測へ
   * 注入する。多重 mount しても _badgeWS Set で 1 ワークスペース 1 回。
   */
  ensureBadgeNotifications = (workspaceSlug: string) => {
    const ws = workspaceSlug || this.store.router.workspaceSlug?.toString() || "";
    if (!ws || this._badgeWS.has(ws)) return;
    this._badgeWS.add(ws);
    // 初回 mount での即時 prefetch だけ. 以降は ADR-033 SSE + ADR-028
    // 自適応 safety interval (realtime-sync.tsx) が refreshBadgeNotifications
    // を呼んで増分同期する.
    this.refreshBadgeNotifications(ws);
  };

  /**
   * BARSOUL: カードバッジ用 notification 一括 refresh.
   *
   * **必ず ALL + MENTIONS の二経路を並列 fetch して store にマージ**.
   * Plane apiserver `notification/base.py` L100-103 が ALL タブで
   * `sender__icontains="mentioned"` を EXCLUDE する仕様のため、ALL のみ
   * 呼ぶと @mention 通知が一切 store に入らず、@mention のみで unread
   * になっている課題カード(例: BS-175)が永遠に既読扱いになる
   * (2026-05-26 当日勃発の bug の根因).
   *
   * 呼び出し元(全て同 method を経由):
   *   1. ensureBadgeNotifications — 初回 mount prefetch
   *   2. realtime-sync.tsx の refreshNotifications(SSE invalidate)
   *   3. realtime-sync.tsx の visibility/focus/online 補強経路
   *   4. realtime-sync.tsx の自適応 safety interval(healthy/degraded)
   *
   * tab state(currentNotificationTab/filters/paginationInfo)には触らない —
   * 通知中心 UI は独自 tab を維持. mutateNotifications は id 上書き semantic
   * なので何度呼んでも冪等. 失敗は静かに飲み(次回 refresh で復旧, §X.4).
   */
  refreshBadgeNotifications = async (workspaceSlug: string): Promise<void> => {
    const ws = workspaceSlug || this.store.router.workspaceSlug?.toString() || "";
    if (!ws) return;
    try {
      // BARSOUL 増分フェッチ: 初回(null)はフル 300件. 以降は `since` を渡して
      // 差分 50件に絞る. since = フェッチ開始前の timestamp なので in-flight 中に
      // 届いた通知も次回の since 窓に必ず入る.
      const since = this._lastBadgeFetchAt ?? undefined;
      const fetchedAt = new Date().toISOString();
      // unread count は SWR(WORKSPACE_UNREAD_NOTIFICATION_COUNT) が
      // realtime-sync.tsx 側で mutate() 経由で別途 refresh しているので
      // ここでは list 二経路のみに専念(double fetch 排除).
      const pageSize = since ? 50 : this.paginatedCount;
      const base: TNotificationPaginatedInfoQueryParams = {
        per_page: pageSize,
        cursor: `${pageSize}:0:0`,
        snoozed: false,
        archived: false,
        ...(since ? { since } : {}),
      };
      const [allResp, menResp] = await Promise.all([
        workspaceNotificationService.fetchNotifications(ws, { ...base }),
        workspaceNotificationService.fetchNotifications(ws, { ...base, mentioned: true }),
      ]);
      runInAction(() => {
        if (allResp?.results) this.mutateNotifications(allResp.results);
        if (menResp?.results) this.mutateNotifications(menResp.results);
      });
      // 成功時のみタイムスタンプを更新(失敗時は次回も同じ since で再試行).
      this._lastBadgeFetchAt = fetchedAt;
    } catch {
      // 失敗は次の SSE / safety interval / visibility 復帰で復旧
    }
  };

  /**
   * BARSOUL: 指定 issue を開いたら、その issue の未読通知を全て既読化する。
   * これが無いと「カードを開いて戻ってもカードの未読印が消えない」（Plane
   * 既定は通知中心で個別クリックした時しか read にならない）。
   * 各モデルの markNotificationAsRead が setUnreadNotificationsCount を
   * 呼ぶので、バッジ/カード装飾は自動で消える（reactivity 既存依存）。
   * ロードされていない通知は対象外＝カード表示と整合（カードもロード済み
   * 通知のみ数える）。失敗は握りつぶし UI を止めない。
   */
  /**
   * BARSOUL: 指定 issue の「最も古い未読通知」が指す活動アンカー
   * (issue_comment 優先、無ければ activity id) を返す。カード(peek)を
   * 開いた時、未読が始まる位置へ自動スクロール＆ハイライトするのに使う
   * （= 通知中心クリック時と同じ scrollToActivityCommentId 機構を再利用）。
   * 既読化の前に呼ぶこと（read 後も data は変わらないが意図を明確に）。
   */
  firstUnreadActivityTarget = (issueId: string | undefined): string | undefined => {
    if (!issueId || isEmpty(this.notifications)) return undefined;
    let best: { ts: number; target: string } | undefined;
    for (const n of Object.values(this.notifications || {})) {
      if (!n) continue;
      const nIssueId = n.data?.issue?.id || n.entity_identifier;
      if (nIssueId !== issueId || n.read_at || n.archived_at || n.snoozed_till) continue;
      const act = n.data?.issue_activity;
      const target = act?.issue_comment || act?.id || undefined;
      if (!target) continue;
      const ts = n.created_at ? new Date(n.created_at).getTime() : 0;
      if (!best || ts < best.ts) best = { ts, target };
    }
    return best?.target;
  };

  markIssueNotificationsAsRead = async (workspaceSlug: string, issueId: string | undefined): Promise<void> => {
    const ws = workspaceSlug || this.store.router.workspaceSlug?.toString() || "";
    if (!ws || !issueId || isEmpty(this.notifications)) return;
    const targets = Object.values(this.notifications || {}).filter((n) => {
      if (!n) return false;
      const nIssueId = n.data?.issue?.id || n.entity_identifier;
      return nIssueId === issueId && !n.read_at && !n.archived_at && !n.snoozed_till;
    });
    await Promise.all(
      targets.map((n) =>
        n.markNotificationAsRead(ws).catch((e) => {
          console.error("markIssueNotificationsAsRead -> error", e);
        })
      )
    );
  };

  // helper functions
  /**
   * @description generate notification query params
   * @returns { object }
   */
  generateNotificationQueryParams = (paramType: TNotificationQueryParamType): TNotificationPaginatedInfoQueryParams => {
    const queryParamsType =
      Object.entries(this.filters.type)
        .filter(([, value]) => value)
        .map(([key]) => key)
        .join(",") || undefined;

    const queryCursorNext =
      paramType === ENotificationQueryParamType.INIT
        ? `${this.paginatedCount}:0:0`
        : paramType === ENotificationQueryParamType.CURRENT
          ? `${this.paginatedCount}:${0}:0`
          : paramType === ENotificationQueryParamType.NEXT && this.paginationInfo
            ? this.paginationInfo?.next_cursor
            : `${this.paginatedCount}:${0}:0`;

    const queryParams: TNotificationPaginatedInfoQueryParams = {
      type: queryParamsType,
      snoozed: this.filters.snoozed || false,
      archived: this.filters.archived || false,
      read: undefined,
      per_page: this.paginatedCount,
      cursor: queryCursorNext,
    };

    // NOTE: This validation is required to show all the read and unread notifications in a single place it may change in future.
    queryParams.read = this.filters.read === true ? false : undefined;

    if (this.currentNotificationTab === ENotificationTab.MENTIONS) queryParams.mentioned = true;

    return queryParams;
  };

  // helper actions
  /**
   * @description mutate and validate current existing and new notifications
   * @param { TNotification[] } notifications
   */
  mutateNotifications = (notifications: TNotification[]) => {
    (notifications || []).forEach((notification) => {
      if (!notification.id) return;
      if (this.notifications[notification.id]) {
        this.notifications[notification.id].mutateNotification(notification);
      } else {
        set(this.notifications, notification.id, new Notification(this.store, notification));
        this._notifUpdateSeq++;
      }
    });
  };

  /**
   * @description update filters
   * @param { T extends keyof TNotificationFilter } key
   * @param { TNotificationFilter[T] } value
   */
  updateFilters = <T extends keyof TNotificationFilter>(key: T, value: TNotificationFilter[T]) => {
    set(this.filters, key, value);
    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return;

    set(this, "notifications", {});
    this.getNotifications(workspaceSlug, ENotificationLoader.INIT_LOADER, ENotificationQueryParamType.INIT);
  };

  /**
   * @description update bulk filters
   * @param { Partial<TNotificationFilter> } filters
   */
  updateBulkFilters = (filters: Partial<TNotificationFilter>) => {
    Object.entries(filters).forEach(([key, value]) => {
      set(this.filters, key, value);
    });

    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return;

    set(this, "notifications", {});
    this.getNotifications(workspaceSlug, ENotificationLoader.INIT_LOADER, ENotificationQueryParamType.INIT);
  };

  // actions
  /**
   * @description set notification tab
   * @returns { void }
   */
  setCurrentNotificationTab = (tab: TNotificationTab): void => {
    set(this, "currentNotificationTab", tab);

    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return;

    set(this, "notifications", {});
    this.getNotifications(workspaceSlug, ENotificationLoader.INIT_LOADER, ENotificationQueryParamType.INIT);
  };

  /**
   * @description set current selected notification
   * @param { string | undefined } notificationId
   * @returns { void }
   */
  setCurrentSelectedNotificationId = (notificationId: string | undefined): void => {
    set(this, "currentSelectedNotificationId", notificationId);
  };

  /**
   * @description set unread notifications count
   * @param { "increment" | "decrement" } type
   * @returns { void }
   */
  setUnreadNotificationsCount = (type: "increment" | "decrement", newCount: number = 1): void => {
    const validCount = Math.max(0, Math.abs(newCount));

    switch (this.currentNotificationTab) {
      case ENotificationTab.ALL:
        update(
          this.unreadNotificationsCount,
          "total_unread_notifications_count",
          (count: number) => +Math.max(0, type === "increment" ? count + validCount : count - validCount)
        );
        break;
      case ENotificationTab.MENTIONS:
        update(
          this.unreadNotificationsCount,
          "mention_unread_notifications_count",
          (count: number) => +Math.max(0, type === "increment" ? count + validCount : count - validCount)
        );
        break;
      default:
        break;
    }
  };

  /**
   * @description get unread notifications count
   * @param { string } workspaceSlug,
   * @param { TNotificationQueryParamType } queryCursorType,
   * @returns { number | undefined }
   */
  getUnreadNotificationsCount = async (workspaceSlug: string): Promise<TUnreadNotificationsCount | undefined> => {
    try {
      const unreadNotificationCount = await workspaceNotificationService.fetchUnreadNotificationsCount(workspaceSlug);
      if (unreadNotificationCount)
        runInAction(() => {
          set(this, "unreadNotificationsCount", unreadNotificationCount);
        });
      return unreadNotificationCount || undefined;
    } catch (error) {
      console.error("WorkspaceNotificationStore -> getUnreadNotificationsCount -> error", error);
      throw error;
    }
  };

  /**
   * @description get all workspace notification
   * @param { string } workspaceSlug,
   * @param { TNotificationLoader } loader,
   * @returns { TNotification | undefined }
   */
  getNotifications = async (
    workspaceSlug: string,
    loader: TNotificationLoader = ENotificationLoader.INIT_LOADER,
    queryParamType: TNotificationQueryParamType = ENotificationQueryParamType.INIT
  ): Promise<TNotificationPaginatedInfo | undefined> => {
    this.loader = loader;
    try {
      const queryParams = this.generateNotificationQueryParams(queryParamType);
      await this.getUnreadNotificationsCount(workspaceSlug);
      const notificationResponse = await workspaceNotificationService.fetchNotifications(workspaceSlug, queryParams);
      if (notificationResponse) {
        const { results, ...paginationInfo } = notificationResponse;
        runInAction(() => {
          if (results) {
            this.mutateNotifications(results);
          }
          set(this, "paginationInfo", paginationInfo);
        });
      }
      return notificationResponse;
    } catch (error) {
      console.error("WorkspaceNotificationStore -> getNotifications -> error", error);
      throw error;
    } finally {
      runInAction(() => (this.loader = undefined));
    }
  };

  /**
   * @description mark all notifications as read
   * @param { string } workspaceSlug,
   * @returns { void }
   */
  markAllNotificationsAsRead = async (workspaceSlug: string): Promise<void> => {
    try {
      this.loader = ENotificationLoader.MARK_ALL_AS_READY;
      const queryParams = this.generateNotificationQueryParams(ENotificationQueryParamType.INIT);
      const params = {
        type: queryParams.type,
        snoozed: queryParams.snoozed,
        archived: queryParams.archived,
        read: queryParams.read,
      };
      await workspaceNotificationService.markAllNotificationsAsRead(workspaceSlug, params);
      runInAction(() => {
        update(
          this.unreadNotificationsCount,
          this.currentNotificationTab === ENotificationTab.ALL
            ? "total_unread_notifications_count"
            : "mention_unread_notifications_count",
          () => 0
        );
        Object.values(this.notifications).forEach((notification) =>
          notification.mutateNotification({
            read_at: new Date().toUTCString(),
          })
        );
      });
    } catch (error) {
      console.error("WorkspaceNotificationStore -> markAllNotificationsAsRead -> error", error);
      throw error;
    } finally {
      runInAction(() => (this.loader = undefined));
    }
  };
}
