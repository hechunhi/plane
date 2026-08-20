/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { clone, update, unset, orderBy, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { EDraftIssuePaginationType } from "@plane/constants";
import type {
  TWorkspaceDraftIssue,
  TWorkspaceDraftPaginationInfo,
  TWorkspaceDraftIssueLoader,
  TWorkspaceDraftQueryParams,
  TPaginationData,
  TLoader,
  TGroupedIssues,
  TSubGroupedIssues,
  ViewFlags,
  TIssue,
  TBulkOperationsPayload,
} from "@plane/types";
import { getCurrentDateTimeInISO, convertToISODateString } from "@plane/utils";
// services
import workspaceDraftService from "@/services/issue/workspace_draft.service";
// types
import type { IIssueRootStore } from "../root.store";

export type TDraftIssuePaginationType = EDraftIssuePaginationType;

/**
 * BARSOUL 2026-08 — サーバ側 `todo_order` の既定値。
 * 個人 ToDo が入る前からある行は全部この値なので、並べ替えの基準としては
 * 「一番下の、順不同の塊」として扱う(第二キーの作成日時で従来の見え方に戻る)。
 */
export const DEFAULT_TODO_ORDER = 65535;
/** 並べ替えで端に落とした時の刻み。float なので中点はいくらでも取れる。 */
const TODO_ORDER_STEP = 1000;

export interface IWorkspaceDraftIssues {
  // observables
  loader: TWorkspaceDraftIssueLoader;
  paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined;
  issuesMap: Record<string, TWorkspaceDraftIssue>; // issue_id -> issue;
  issueMapIds: Record<string, string[]>; // workspace_id -> issue_ids;
  completedLoader: TWorkspaceDraftIssueLoader;
  completedFetched: boolean;
  // computed
  issueIds: string[];
  completedIssueIds: string[];
  // computed functions
  getIssueById: (issueId: string) => TWorkspaceDraftIssue | undefined;
  /** BARSOUL 2026-08: ある ToDo の子タスク(済も含む・並び順どおり)。 */
  getSubIssueIds: (parentId: string) => string[];
  /** BARSOUL 2026-08: 子タスクの進み(済 / 全)。0 件なら undefined。 */
  getSubIssueProgress: (parentId: string) => { done: number; total: number } | undefined;
  // helper actions
  addIssue: (issues: TWorkspaceDraftIssue[]) => void;
  mutateIssue: (issueId: string, data: Partial<TWorkspaceDraftIssue>) => void;
  removeIssue: (issueId: string) => Promise<void>;
  // actions
  fetchIssues: (
    workspaceSlug: string,
    loadType: TWorkspaceDraftIssueLoader,
    paginationType?: TDraftIssuePaginationType
  ) => Promise<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue> | undefined>;
  fetchCompletedIssues: (workspaceSlug: string) => Promise<void>;
  toggleDone: (workspaceSlug: string, issueId: string) => Promise<void>;
  createIssue: (
    workspaceSlug: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  updateIssue: (
    workspaceSlug: string,
    issueId: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  deleteIssue: (workspaceSlug: string, issueId: string) => Promise<void>;
  /** BARSOUL 2026-08: 子タスクを 1 行足す(既定は親の一番下)。 */
  createSubIssue: (
    workspaceSlug: string,
    parentId: string,
    name: string,
    todoOrder?: number
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  /** BARSOUL 2026-08: 並べ替え。落とした前後の中点を取って todo_order に書く。 */
  reorderIssue: (
    workspaceSlug: string,
    issueId: string,
    parentId: string | null,
    beforeId: string | undefined,
    afterId: string | undefined
  ) => Promise<void>;
  moveIssue: (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue>) => Promise<TIssue>;
  addCycleToIssue: (
    workspaceSlug: string,
    issueId: string,
    cycleId: string
  ) => Promise<TWorkspaceDraftIssue | undefined>;
  addModulesToIssue: (
    workspaceSlug: string,
    issueId: string,
    moduleIds: string[]
  ) => Promise<TWorkspaceDraftIssue | undefined>;

  // dummies
  viewFlags: ViewFlags;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined;
  getIssueIds: (groupId?: string, subGroupId?: string) => string[] | undefined;
  getPaginationData(groupId: string | undefined, subGroupId: string | undefined): TPaginationData | undefined;
  getIssueLoader(groupId?: string, subGroupId?: string): TLoader;
  getGroupIssueCount: (
    groupId: string | undefined,
    subGroupId: string | undefined,
    isSubGroupCumulative: boolean
  ) => number | undefined;
  removeCycleFromIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  addIssueToCycle: (
    workspaceSlug: string,
    projectId: string,
    cycleId: string,
    issueIds: string[],
    fetchAddedIssues?: boolean
  ) => Promise<void>;
  removeIssueFromCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;

  removeIssuesFromModule: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    issueIds: string[]
  ) => Promise<void>;
  changeModulesInIssue(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ): Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;
}

export class WorkspaceDraftIssues implements IWorkspaceDraftIssues {
  // local constants
  paginatedCount = 50;
  // observables
  loader: TWorkspaceDraftIssueLoader = undefined;
  paginationInfo: Omit<TWorkspaceDraftPaginationInfo<TWorkspaceDraftIssue>, "results"> | undefined = undefined;
  issuesMap: Record<string, TWorkspaceDraftIssue> = {};
  issueMapIds: Record<string, string[]> = {};
  // BARSOUL 2026-08: 「完了した ToDo」の引き出し。開くまで取りに行かない。
  completedLoader: TWorkspaceDraftIssueLoader = undefined;
  completedFetched = false;

  constructor(public issueStore: IIssueRootStore) {
    makeObservable(this, {
      loader: observable.ref,
      paginationInfo: observable,
      issuesMap: observable,
      issueMapIds: observable,
      completedLoader: observable.ref,
      completedFetched: observable.ref,
      // computed
      issueIds: computed,
      completedIssueIds: computed,
      // action
      fetchIssues: action,
      fetchCompletedIssues: action,
      toggleDone: action,
      createIssue: action,
      updateIssue: action,
      deleteIssue: action,
      createSubIssue: action,
      reorderIssue: action,
      moveIssue: action,
      addCycleToIssue: action,
      addModulesToIssue: action,
    });
  }

  private updateWorkspaceUserDraftIssueCount(workspaceSlug: string, increment: number) {
    const workspaceUserInfo = this.issueStore.rootStore.user.permission.workspaceUserInfo;
    const currentCount = workspaceUserInfo[workspaceSlug]?.draft_issue_count ?? 0;

    set(workspaceUserInfo, [workspaceSlug, "draft_issue_count"], currentCount + increment);
  }

  // computed
  /**
   * BARSOUL 2026-08 — 活きている ToDo だけ。
   * 済んだものは同じ `issueMapIds` に居るが `done_at` で振り分ける。
   * 二本目のマップを持たないのは、チェックを付け外しした時に
   * 「どっちのリストが正か」を考えなくて済むようにするため。
   */
  get issueIds() {
    const workspaceSlug = this.issueStore.workspaceSlug;
    if (!workspaceSlug) return [];
    if (!this.issueMapIds[workspaceSlug]) return [];
    // 一覧に出るのは親だけ。子は親の下に畳んで出す(getSubIssueIds)。
    const issueIds = this.issueMapIds[workspaceSlug].filter(
      (issueId) => !this.issuesMap[issueId]?.done_at && !this.issuesMap[issueId]?.todo_parent_id
    );
    // 手で並べた順が第一。未設定(既定 65535)の行は同値なので、
    // 第二キーの作成日時の降順 = 従来どおり「新しいものが上」に落ち着く。
    return orderBy(
      issueIds,
      [
        (issueId) => this.issuesMap[issueId]?.todo_order ?? DEFAULT_TODO_ORDER,
        (issueId) => convertToISODateString(this.issuesMap[issueId]?.created_at),
      ],
      ["asc", "desc"]
    );
  }

  /** 済んだ ToDo(新しい順)。引き出しの中身。子は親の下に居るので出さない。 */
  get completedIssueIds() {
    const workspaceSlug = this.issueStore.workspaceSlug;
    if (!workspaceSlug) return [];
    if (!this.issueMapIds[workspaceSlug]) return [];
    const issueIds = this.issueMapIds[workspaceSlug].filter(
      (issueId) => !!this.issuesMap[issueId]?.done_at && !this.issuesMap[issueId]?.todo_parent_id
    );
    return orderBy(issueIds, (issueId) => convertToISODateString(this.issuesMap[issueId]?.done_at ?? undefined), [
      "desc",
    ]);
  }

  // computed functions
  getIssueById = computedFn((issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return undefined;
    return this.issuesMap[issueId];
  });

  /**
   * BARSOUL 2026-08 — 子タスク。**済んだ子も返す**。
   * 済んだ子を隠すと「消えた」に見えるので、行を残して取り消し線を引く方に倒す。
   * 並びは親と違い作成が古い順 —— 分解は上から書き足していく作業だから。
   */
  getSubIssueIds = computedFn((parentId: string) => {
    const workspaceSlug = this.issueStore.workspaceSlug;
    if (!workspaceSlug || !this.issueMapIds[workspaceSlug]) return [];
    const childIds = this.issueMapIds[workspaceSlug].filter(
      (issueId) => this.issuesMap[issueId]?.todo_parent_id === parentId
    );
    return orderBy(
      childIds,
      [
        (issueId) => this.issuesMap[issueId]?.todo_order ?? DEFAULT_TODO_ORDER,
        (issueId) => convertToISODateString(this.issuesMap[issueId]?.created_at),
      ],
      ["asc", "asc"]
    );
  });

  /** 「2/5」の数字。子が居ない親には出さない。 */
  getSubIssueProgress = computedFn((parentId: string) => {
    const childIds = this.getSubIssueIds(parentId);
    if (childIds.length === 0) return undefined;
    return {
      done: childIds.filter((issueId) => !!this.issuesMap[issueId]?.done_at).length,
      total: childIds.length,
    };
  });

  // helper actions
  addIssue = (issues: TWorkspaceDraftIssue[]) => {
    if (issues && issues.length <= 0) return;
    runInAction(() => {
      issues.forEach((issue) => {
        if (!this.issuesMap[issue.id]) set(this.issuesMap, issue.id, issue);
        else update(this.issuesMap, issue.id, (prevIssue) => ({ ...prevIssue, ...issue }));
      });
    });
  };

  mutateIssue = (issueId: string, issue: Partial<TWorkspaceDraftIssue>) => {
    if (!issue || !issueId || !this.issuesMap[issueId]) return;
    runInAction(() => {
      set(this.issuesMap, [issueId, "updated_at"], getCurrentDateTimeInISO());
      Object.keys(issue).forEach((key) => {
        set(this.issuesMap, [issueId, key], issue[key as keyof TWorkspaceDraftIssue]);
      });
    });
  };

  removeIssue = async (issueId: string) => {
    if (!issueId || !this.issuesMap[issueId]) return;
    runInAction(() => unset(this.issuesMap, issueId));
  };

  generateNotificationQueryParams = (
    paramType: TDraftIssuePaginationType,
    filterParams = {}
  ): TWorkspaceDraftQueryParams => {
    const queryCursorNext: string =
      paramType === EDraftIssuePaginationType.INIT
        ? `${this.paginatedCount}:0:0`
        : paramType === EDraftIssuePaginationType.CURRENT
          ? `${this.paginatedCount}:${0}:0`
          : paramType === EDraftIssuePaginationType.NEXT && this.paginationInfo
            ? (this.paginationInfo?.next_cursor ?? `${this.paginatedCount}:${0}:0`)
            : `${this.paginatedCount}:${0}:0`;

    const queryParams: TWorkspaceDraftQueryParams = {
      per_page: this.paginatedCount,
      cursor: queryCursorNext,
      ...filterParams,
    };

    return queryParams;
  };

  // actions
  fetchIssues = async (
    workspaceSlug: string,
    loadType: TWorkspaceDraftIssueLoader,
    paginationType: TDraftIssuePaginationType = EDraftIssuePaginationType.INIT
  ) => {
    try {
      this.loader = loadType;

      // filter params and pagination params
      const filterParams = {};
      const params = this.generateNotificationQueryParams(paginationType, filterParams);

      // fetching the paginated workspace draft issues
      const draftIssuesResponse = await workspaceDraftService.getIssues(workspaceSlug, { ...params });
      if (!draftIssuesResponse) return undefined;

      const { results, ...paginationInfo } = draftIssuesResponse;
      runInAction(() => {
        if (results && results.length > 0) {
          // adding issueIds
          const issueIds = results.map((issue) => issue.id);
          const existingIssueIds = this.issueMapIds[workspaceSlug] ?? [];
          // new issueIds
          const newIssueIds = issueIds.filter((issueId) => !existingIssueIds.includes(issueId));
          this.addIssue(results);
          // issue map update
          update(this.issueMapIds, [workspaceSlug], (existingIssueIds = []) => [...newIssueIds, ...existingIssueIds]);
          this.loader = undefined;
        } else {
          this.loader = "empty-state";
        }
        set(this, "paginationInfo", paginationInfo);
      });
      return draftIssuesResponse;
    } catch (error) {
      // set loader to undefined if errored out
      this.loader = undefined;
      throw error;
    }
  };

  /**
   * BARSOUL 2026-08 — 「完了した ToDo」を一度だけ取りに行く。
   * ページングは付けていない(引き出しは振り返り用で、無限に遡る場所ではない)。
   * 一覧側の `paginationInfo` は **書き換えない** —— あれは活きている ToDo の件数。
   */
  fetchCompletedIssues = async (workspaceSlug: string) => {
    try {
      this.completedLoader = "init-loader";
      const response = await workspaceDraftService.getIssues(workspaceSlug, {
        per_page: this.paginatedCount,
        cursor: `${this.paginatedCount}:0:0`,
        done: true,
      });
      runInAction(() => {
        const results = response?.results ?? [];
        if (results.length > 0) {
          this.addIssue(results);
          const existingIssueIds = this.issueMapIds[workspaceSlug] ?? [];
          const newIssueIds = results.map((issue) => issue.id).filter((id) => !existingIssueIds.includes(id));
          update(this.issueMapIds, [workspaceSlug], (ids = []) => [...ids, ...newIssueIds]);
        }
        this.completedFetched = true;
        this.completedLoader = undefined;
      });
    } catch (error) {
      this.completedLoader = undefined;
      throw error;
    }
  };

  /**
   * BARSOUL 2026-08 — チェックの付け外し。
   * 楽観更新してから PATCH、失敗したら元に戻す(= 一覧の並びが勝手に戻る)。
   * サイドバーのバッジは未完だけを数えるので、ここで増減も反映する。
   */
  toggleDone = async (workspaceSlug: string, issueId: string) => {
    const issue = this.getIssueById(issueId);
    if (!issue) return;
    const nextDoneAt = issue.done_at ? null : getCurrentDateTimeInISO();
    const previousDoneAt = issue.done_at ?? null;
    // バッジは親だけを数える(サーバ側の集計と揃える)。
    const countDelta = issue.todo_parent_id ? 0 : nextDoneAt ? -1 : 1;
    runInAction(() => {
      set(this.issuesMap, [issueId, "done_at"], nextDoneAt);
      this.updateWorkspaceUserDraftIssueCount(workspaceSlug, countDelta);
    });
    try {
      await workspaceDraftService.updateIssue(workspaceSlug, issueId, {
        done_at: nextDoneAt,
      } as Partial<TWorkspaceDraftIssue>);
    } catch (error) {
      runInAction(() => {
        set(this.issuesMap, [issueId, "done_at"], previousDoneAt);
        this.updateWorkspaceUserDraftIssueCount(workspaceSlug, -countDelta);
      });
      throw error;
    }
  };

  createIssue = async (
    workspaceSlug: string,
    payload: Partial<TWorkspaceDraftIssue | TIssue>
  ): Promise<TWorkspaceDraftIssue | undefined> => {
    try {
      this.loader = "create";

      const response = await workspaceDraftService.createIssue(workspaceSlug, payload);
      if (response) {
        runInAction(() => {
          this.addIssue([response]);
          update(this.issueMapIds, [workspaceSlug], (existingIssueIds = []) => [response.id, ...existingIssueIds]);
          // increase the count of issues in the pagination info
          if (this.paginationInfo?.total_count) {
            set(this, "paginationInfo", {
              ...this.paginationInfo,
              total_count: this.paginationInfo.total_count + 1,
            });
          }
          // Update draft issue count in workspaceUserInfo
          this.updateWorkspaceUserDraftIssueCount(workspaceSlug, 1);
        });
      }

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  updateIssue = async (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue | TIssue>) => {
    const issueBeforeUpdate = clone(this.getIssueById(issueId));
    try {
      this.loader = "update";
      runInAction(() => {
        set(this.issuesMap, [issueId], {
          ...issueBeforeUpdate,
          ...payload,
          ...{ updated_at: getCurrentDateTimeInISO() },
        });
      });
      const response = await workspaceDraftService.updateIssue(workspaceSlug, issueId, payload);
      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      runInAction(() => {
        set(this.issuesMap, [issueId], issueBeforeUpdate);
      });
      throw error;
    }
  };

  deleteIssue = async (workspaceSlug: string, issueId: string) => {
    try {
      this.loader = "delete";

      // BARSOUL: 親を消すとサーバ側で子も道連れ(CASCADE)。画面にも同じ事を起こす。
      const isSubIssue = !!this.getIssueById(issueId)?.todo_parent_id;
      const removedIds = [issueId, ...this.getSubIssueIds(issueId)];
      const response = await workspaceDraftService.deleteIssue(workspaceSlug, issueId);
      runInAction(() => {
        // Remove the issue from the issueMapIds
        this.issueMapIds[workspaceSlug] = (this.issueMapIds[workspaceSlug] || []).filter(
          (id) => !removedIds.includes(id)
        );
        // Remove the issue from the issuesMap
        removedIds.forEach((id) => delete this.issuesMap[id]);
        // reduce the count of issues in the pagination info
        if (!isSubIssue && this.paginationInfo?.total_count) {
          set(this, "paginationInfo", {
            ...this.paginationInfo,
            total_count: this.paginationInfo.total_count - 1,
          });
        }
        // Update draft issue count in workspaceUserInfo
        this.updateWorkspaceUserDraftIssueCount(workspaceSlug, isSubIssue ? 0 : -1);
      });

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  /**
   * BARSOUL 2026-08 — 子タスクを 1 行足す。
   * 置き場所(`todo_order`)はサーバが決める(親の一番下)。端末間でぶれないため。
   * バッジは親だけ数えるので、ここでは増やさない。
   */
  createSubIssue = async (workspaceSlug: string, parentId: string, name: string, todoOrder?: number) => {
    const parent = this.getIssueById(parentId);
    if (!parent) return undefined;
    const response = await workspaceDraftService.createIssue(workspaceSlug, {
      name,
      // 親のプロジェクトを引き継ぐ。分解した先だけ別プロジェクト、は要らない。
      project_id: parent.project_id,
      todo_parent_id: parentId,
      // 行間に差し込む時だけ位置を指定する。指定が無ければサーバが末尾に置く。
      ...(todoOrder === undefined ? {} : { todo_order: todoOrder }),
    } as Partial<TWorkspaceDraftIssue>);
    if (response) {
      runInAction(() => {
        this.addIssue([response]);
        update(this.issueMapIds, [workspaceSlug], (existingIssueIds = []) => [...existingIssueIds, response.id]);
      });
    }
    return response;
  };

  /**
   * BARSOUL 2026-08 — 並べ替え。
   * 「落とした場所の前後」の中点を取るだけ。全行を振り直さないので、
   * 1 回の並べ替えで飛ぶ PATCH は常に 1 本。
   * 端に落とした時は既存の端から一定量ずらす。
   */
  reorderIssue = async (
    workspaceSlug: string,
    issueId: string,
    parentId: string | null,
    beforeId: string | undefined,
    afterId: string | undefined
  ) => {
    const issue = this.getIssueById(issueId);
    if (!issue) return;
    const orderOf = (id: string | undefined) =>
      id ? (this.getIssueById(id)?.todo_order ?? DEFAULT_TODO_ORDER) : undefined;
    const before = orderOf(beforeId);
    const after = orderOf(afterId);

    let nextOrder: number;
    if (before !== undefined && after !== undefined) nextOrder = (before + after) / 2;
    else if (before !== undefined) nextOrder = before + TODO_ORDER_STEP;
    else if (after !== undefined) nextOrder = after - TODO_ORDER_STEP;
    else nextOrder = 0;

    const previous = { todo_order: issue.todo_order, todo_parent_id: issue.todo_parent_id };
    runInAction(() => {
      set(this.issuesMap, [issueId, "todo_order"], nextOrder);
      set(this.issuesMap, [issueId, "todo_parent_id"], parentId);
    });
    try {
      await workspaceDraftService.updateIssue(workspaceSlug, issueId, {
        todo_order: nextOrder,
        todo_parent_id: parentId,
      } as Partial<TWorkspaceDraftIssue>);
    } catch (error) {
      runInAction(() => {
        set(this.issuesMap, [issueId, "todo_order"], previous.todo_order);
        set(this.issuesMap, [issueId, "todo_parent_id"], previous.todo_parent_id);
      });
      throw error;
    }
  };

  moveIssue = async (workspaceSlug: string, issueId: string, payload: Partial<TWorkspaceDraftIssue>) => {
    try {
      this.loader = "move";

      // BARSOUL: メモと子タスクは本文へ畳み込まれてから下書きごと消える(サーバ側)。
      // 画面でも親と一緒に子を引き上げる。
      const removedIds = [issueId, ...this.getSubIssueIds(issueId)];
      const response = await workspaceDraftService.moveIssue(workspaceSlug, issueId, payload);
      runInAction(() => {
        // Remove the issue from the issueMapIds
        this.issueMapIds[workspaceSlug] = (this.issueMapIds[workspaceSlug] || []).filter(
          (id) => !removedIds.includes(id)
        );
        // Remove the issue from the issuesMap
        removedIds.forEach((id) => delete this.issuesMap[id]);
        // reduce the count of issues in the pagination info
        if (this.paginationInfo?.total_count) {
          set(this, "paginationInfo", {
            ...this.paginationInfo,
            total_count: this.paginationInfo.total_count - 1,
          });
        }

        // Update draft issue count in workspaceUserInfo
        this.updateWorkspaceUserDraftIssueCount(workspaceSlug, -1);
      });

      this.loader = undefined;
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  addCycleToIssue = async (workspaceSlug: string, issueId: string, cycleId: string) => {
    try {
      this.loader = "update";
      const response = await this.updateIssue(workspaceSlug, issueId, { cycle_id: cycleId });
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  addModulesToIssue = async (workspaceSlug: string, issueId: string, moduleIds: string[]) => {
    try {
      this.loader = "update";
      const response = this.updateIssue(workspaceSlug, issueId, { module_ids: moduleIds });
      return response;
    } catch (error) {
      this.loader = undefined;
      throw error;
    }
  };

  // dummies
  viewFlags: ViewFlags = { enableQuickAdd: false, enableIssueCreation: false, enableInlineEditing: false };
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined = undefined;
  getIssueIds = (_groupId?: string, _subGroupId?: string) => undefined;
  getPaginationData = (_groupId: string | undefined, _subGroupId: string | undefined) => undefined;
  getIssueLoader = (_groupId?: string, _subGroupId?: string) => "loaded" as TLoader;
  getGroupIssueCount = (
    _groupId: string | undefined,
    _subGroupId: string | undefined,
    _isSubGroupCumulative: boolean
  ) => undefined;
  removeCycleFromIssue = async (_workspaceSlug: string, _projectId: string, _issueId: string) => {};
  addIssueToCycle = async (
    _workspaceSlug: string,
    _projectId: string,
    _cycleId: string,
    _issueIds: string[],
    _fetchAddedIssues?: boolean
  ) => {};
  removeIssueFromCycle = async (_workspaceSlug: string, _projectId: string, _cycleId: string, _issueId: string) => {};

  removeIssuesFromModule = async (
    _workspaceSlug: string,
    _projectId: string,
    _moduleId: string,
    _issueIds: string[]
  ) => {};
  changeModulesInIssue = async (
    _workspaceSlug: string,
    _projectId: string,
    _issueId: string,
    _addModuleIds: string[],
    _removeModuleIds: string[]
  ) => {};
  archiveIssue = async (_workspaceSlug: string, _projectId: string, _issueId: string) => {};
  archiveBulkIssues = async (_workspaceSlug: string, _projectId: string, _issueIds: string[]) => {};
  removeBulkIssues = async (_workspaceSlug: string, _projectId: string, _issueIds: string[]) => {};
  bulkUpdateProperties = async (_workspaceSlug: string, _projectId: string, _data: TBulkOperationsPayload) => {};
}
