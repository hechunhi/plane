/**
 * BARSOUL Pin/收藏(IUTEYA-9, 2026-05-27):
 *
 * issue カードに per-user ピン機能を追加. backend は既存 UserFavorite
 * 仕組み(`/api/workspaces/{slug}/user-favorites/`)を `entity_type="issue"`
 * で再利用 → backend 変更ゼロ.
 *
 * 設計:
 *  - workspace 単位で一度だけ fetch + Set<issue_id> reactive cache
 *  - togglePin: optimistic — UI 即 toggle, API 失敗時 revert
 *  - sort: kanban/list block render 側で pinned-first split 配列
 *
 * Tier 1: ★ button + visual + sort.  Tier 2(別途): サイドバー
 * 「📌 My Pins」入口、cross-project 集合ビュー.
 */
import { makeObservable, observable, action, computed, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { APIService } from "@/services/api.service";

type TPinRecord = {
  id: string;            // user_favorite row id
  entity_identifier: string;  // issue id
  project_id: string | null;
};

export interface IPinnedIssuesStore {
  /** issue id → user_favorite row(API DELETE 時に id 必要). */
  pinMap: Record<string, TPinRecord>;
  /** 既に fetch 済みワークスペース slug の集合(初回 mount idempotent). */
  fetchedWS: Set<string>;
  /** reactive Set<issue_id> — pinned 判定 / sort 用. */
  pinnedSet: Set<string>;
  /** computedFn — observer 内で個別 issue の pin 状態を読む(細粒度 reactive). */
  isPinned: (issueId: string | undefined) => boolean;
  /** workspace mount 時 1 回 fetch — idempotent. */
  ensureFetched: (workspaceSlug: string) => void;
  /** toggle: 既 pinned → DELETE, 未 pinned → POST. optimistic. */
  togglePin: (workspaceSlug: string, issueId: string, projectId: string) => Promise<void>;
}

export class PinnedIssuesStore implements IPinnedIssuesStore {
  pinMap: Record<string, TPinRecord> = {};
  fetchedWS: Set<string> = new Set();
  private api: APIService;

  constructor() {
    this.api = new APIService("");
    makeObservable(this, {
      pinMap: observable,
      pinnedSet: computed,
      ensureFetched: action,
      togglePin: action,
    });
  }

  get pinnedSet(): Set<string> {
    return new Set(Object.keys(this.pinMap));
  }

  isPinned = computedFn((issueId: string | undefined): boolean => {
    if (!issueId) return false;
    return !!this.pinMap[issueId];
  });

  ensureFetched = (workspaceSlug: string) => {
    if (!workspaceSlug || this.fetchedWS.has(workspaceSlug)) return;
    this.fetchedWS.add(workspaceSlug);
    this._fetch(workspaceSlug).catch(() => {
      // 次回 mount で再試行可能に
      this.fetchedWS.delete(workspaceSlug);
    });
  };

  private _fetch = async (workspaceSlug: string): Promise<void> => {
    try {
      const r = await this.api.get(`/api/workspaces/${workspaceSlug}/user-favorites/`);
      const rows: any[] = Array.isArray(r?.data) ? r.data : [];
      runInAction(() => {
        for (const row of rows) {
          if (row?.entity_type !== "issue") continue;
          if (!row.entity_identifier) continue;
          this.pinMap[row.entity_identifier] = {
            id: row.id,
            entity_identifier: row.entity_identifier,
            project_id: row.project_id ?? null,
          };
        }
      });
    } catch {
      // silent: 次回 mount / 手動 toggle で復旧試行
    }
  };

  togglePin = async (workspaceSlug: string, issueId: string, projectId: string): Promise<void> => {
    if (!workspaceSlug || !issueId) return;
    const existing = this.pinMap[issueId];

    if (existing) {
      // UNPIN — optimistic: store から先に消す
      runInAction(() => {
        delete this.pinMap[issueId];
      });
      try {
        await this.api.delete(
          `/api/workspaces/${workspaceSlug}/user-favorites/${existing.id}/`
        );
      } catch (e) {
        // revert
        runInAction(() => {
          this.pinMap[issueId] = existing;
        });
        throw e;
      }
    } else {
      // PIN — optimistic: 仮 id で先に入れる、成功時 server id で差し替え
      const tempId = `_tmp_${issueId}`;
      runInAction(() => {
        this.pinMap[issueId] = { id: tempId, entity_identifier: issueId, project_id: projectId };
      });
      try {
        const r = await this.api.post(
          `/api/workspaces/${workspaceSlug}/user-favorites/`,
          { entity_type: "issue", entity_identifier: issueId, project_id: projectId }
        );
        const row = r?.data;
        if (row?.id) {
          runInAction(() => {
            this.pinMap[issueId] = {
              id: row.id, entity_identifier: issueId, project_id: projectId,
            };
          });
        }
      } catch (e) {
        // revert
        runInAction(() => {
          delete this.pinMap[issueId];
        });
        throw e;
      }
    }
  };
}
