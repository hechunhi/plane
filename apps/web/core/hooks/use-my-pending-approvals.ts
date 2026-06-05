/**
 * BARSOUL ADR-029 続: 「我作為審批人」workspace 全体 inbox.
 *
 * 顶栏徽章 + 列表/看板 sticky banner + document.title prefix + favicon
 * dynamic dot は皆この 1 個の hook を共有する(SWR キー共通 → 1 fetch).
 * SoR は ai-bot /api/approval/my-pending(Caddy /__approval/my-pending 経由,
 * 同源 LAN-only). 未ログイン/取得失敗は count=0 安全側へ.
 */
import useSWR from "swr";
import { useUser } from "@/hooks/store/user/user-user";

export type TPendingApprovalItem = {
  no: string;
  issue_id: string | null;
  project_id: string | null;
  mode: "ALL" | "ANY" | "SEQUENTIAL";
  role: "pending_approver" | "queued_approver";
};

export type TMyPendingApprovals = {
  items: TPendingApprovalItem[];
  count: number;
};

export const myPendingApprovalsSWRKey = (userId: string | undefined) =>
  userId ? `MY_PENDING_APPROVALS:${userId}` : null;

const fetchMyPending = async (userId: string): Promise<TMyPendingApprovals> => {
  try {
    const r = await fetch(`/__approval/my-pending?user=${encodeURIComponent(userId)}`, {
      credentials: "same-origin",
    });
    if (!r.ok) return { items: [], count: 0 };
    const j = (await r.json()) as TMyPendingApprovals;
    return { items: j.items || [], count: j.count || 0 };
  } catch {
    return { items: [], count: 0 };
  }
};

export const useMyPendingApprovals = () => {
  const { data: userData } = useUser();
  const myId = userData?.id;

  const { data, mutate, isLoading } = useSWR<TMyPendingApprovals>(
    myPendingApprovalsSWRKey(myId),
    myId ? () => fetchMyPending(myId) : null,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      // 60s — 顶栏常駐, 5min は遅すぎ; sentinel が動くまで自分で気づける幅.
      refreshInterval: 60_000,
    }
  );

  const items = data?.items ?? [];
  const count = data?.count ?? 0;
  // 「対応必須」のみ顶栏でハイライト. queued は弱表示用に分離.
  const pendingCount = items.filter((i) => i.role === "pending_approver").length;
  const queuedCount = items.filter((i) => i.role === "queued_approver").length;

  return {
    items,
    count,
    pendingCount,
    queuedCount,
    isLoading: isLoading && !data,
    refresh: mutate,
  };
};
