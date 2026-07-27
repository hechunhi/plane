/**
 * BARSOUL「我的工作」— 増強レンズのデータ源 (hechun 2026-07-25)
 *
 * 「動態 / @我」は通知センターの store をそのまま使う(= 二重実装を作らない)。
 * この hook が足すのは通知に**無い**視点だけ:
 *   ・球が自分に来ている / 情報が足りない  → DIS 集約(派生・読み取り専用)
 *   ・自分に指派された未完了カード          → 原生 workspace issues
 *   ・自分が承認者の申請                    → 承認台帳(Temporal が書く SoR)
 * すべて読み取り専用。ここから SoR を書くことは無い。
 */
import useSWR from "swr";
import { useUser } from "@/hooks/store/user";
import { useMyPendingApprovals } from "@/hooks/use-my-pending-approvals";
import type { DerivedIssueState } from "@/components/issues/issue-layouts/kanban/ai-state-line";

export type TWorkDigestItem = DerivedIssueState & {
  name: string;
  sequence_id: number | null;
  project_id: string;
  project_identifier: string;
  state_group: string | null;
};

export type TWorkAssignedItem = {
  issue_id: string;
  project_id: string;
  name: string;
  sequence_id?: number;
  state_group?: string;
  target_date?: string | null;
};

const jsonGet = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

/** ページングされていても配列で受け取る(端点により results 包みが違う)。 */
const rowsOf = (data: unknown): Record<string, unknown>[] => {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const res = (data as { results?: unknown })?.results;
  return Array.isArray(res) ? (res as Record<string, unknown>[]) : [];
};

export function useMyWorkSources(workspaceSlug: string) {
  const { data: userData } = useUser();
  const uid = userData?.id;

  // DIS 派生。信頼度が低い推測は出さない — 作业台に嘘を並べない方が大事。
  const { data: digest, isLoading: digestLoading } = useSWR<TWorkDigestItem[]>(
    workspaceSlug ? `MY_WORK_DIS:${workspaceSlug}` : null,
    async () => {
      const data = (await jsonGet(`/api/workspaces/${workspaceSlug}/my-work/ai-states/`)) as Record<
        string,
        TWorkDigestItem
      >;
      return Object.values(data || {}).filter((x) => (x.ball && (x.confidence ?? 0) >= 0.4) || x.needs_info);
    },
    { revalidateOnFocus: true, dedupingInterval: 30_000 }
  );

  // 指派。DIS の判定が無い backlog も含む「自分の持ち物」の全量。
  const { data: assigned, isLoading: assignedLoading } = useSWR<TWorkAssignedItem[]>(
    workspaceSlug && uid ? `MY_WORK_ASSIGNED:${workspaceSlug}:${uid}` : null,
    async () => {
      const data = await jsonGet(
        `/api/workspaces/${workspaceSlug}/issues/?assignees=${uid}&state_group=backlog,unstarted,started&per_page=100`
      );
      return rowsOf(data)
        .map((n) => {
          if (!n?.id || !n?.project_id) return null;
          return {
            issue_id: String(n.id),
            project_id: String(n.project_id),
            name: String(n.name || ""),
            sequence_id: n.sequence_id as number | undefined,
            state_group: n.state__group as string | undefined,
            target_date: (n.target_date as string | null) ?? null,
          } satisfies TWorkAssignedItem;
        })
        .filter(Boolean) as TWorkAssignedItem[];
    },
    { revalidateOnFocus: true, dedupingInterval: 30_000 }
  );

  const approvals = useMyPendingApprovals();

  return {
    digest: digest ?? [],
    assigned: assigned ?? [],
    approvals,
    isLoading: digestLoading || assignedLoading,
  };
}
