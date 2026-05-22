/**
 * BARSOUL ADR-029: 凍結カード UX(役割別)用 client hook.
 *
 * 真相源 = ai-bot `/api/issue/approval/{id}` (Lark Base 待批レコード + action
 * log 由来). frozen ラベルは「派生キャッシュ」であり信頼してはならない
 * (ghost 残留が観測される). 本 hook は権威データに基づき myRole を派生:
 *   - pending_approver  : 自分が approver で未決(SEQ 時は current のみ)
 *   - queued_approver   : SEQ で自分が approver だが未到自己番
 *   - initiator         : 自分が発起人
 *   - bystander         : 自分は approver 既決 or 無関係見守る
 *   - none              : frozen 無し
 *
 * キャッシュ: SWR 30s dedup, focus/online で revalidate, SSE invalidate は
 *   realtime-sync 側で `mutate('ISSUE_APPROVAL:...')` を呼ぶ(連携拡張).
 */
import useSWR from "swr";
import { useUser } from "@/hooks/store/user/user-user";

export type TApprover = {
  id: string;
  name: string;
  decided: boolean;
  decision: string | null;
  is_current?: boolean;
  order: number;
};

export type TIssueApprovalData = {
  frozen: boolean;
  no?: string;
  status?: string;
  mode?: "ALL" | "ANY" | "SEQUENTIAL";
  initiator?: { id: string; name: string };
  approvers?: TApprover[];
};

export type TFrozenRole =
  | "pending_approver"
  | "queued_approver"
  | "initiator"
  | "bystander"
  | "none";

export const issueApprovalSWRKey = (issueId: string) => `ISSUE_APPROVAL:${issueId}`;

const fetchIssueApproval = async (issueId: string): Promise<TIssueApprovalData> => {
  try {
    const r = await fetch(`/__approval/by-issue/${issueId}`, {
      credentials: "same-origin",
    });
    if (!r.ok) return { frozen: false };
    return (await r.json()) as TIssueApprovalData;
  } catch {
    return { frozen: false };
  }
};

export const useIssueApproval = (issueId: string | undefined) => {
  const { data: userData } = useUser();
  const myId = userData?.id;
  const { data, mutate } = useSWR<TIssueApprovalData>(
    issueId ? issueApprovalSWRKey(issueId) : null,
    issueId ? () => fetchIssueApproval(issueId) : null,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      // refresh は SSE invalidate 経由 (realtime-sync が mutate) で十分.
      // safetynet として 5min 自動 revalidate (低頻度, UX 担保).
      refreshInterval: 5 * 60_000,
    }
  );

  const frozen = data?.frozen ?? false;
  let myRole: TFrozenRole = "none";
  if (frozen && myId && data) {
    const me = data.approvers?.find((a) => a.id === myId);
    const isInitiator = data.initiator?.id === myId;
    if (me) {
      if (me.decided) {
        myRole = "bystander"; // 已決 → 見守
      } else if (data.mode === "SEQUENTIAL" && !me.is_current) {
        myRole = "queued_approver"; // SEQ 待ち番
      } else {
        myRole = "pending_approver"; // あなたの番
      }
    } else if (isInitiator) {
      myRole = "initiator";
    } else {
      myRole = "bystander";
    }
  }

  return {
    approval: data,
    frozen,
    myRole,
    /** 既存 approver 仅 SEQ 場合 me.is_current */
    isMyTurn: myRole === "pending_approver",
    refresh: mutate,
  };
};
