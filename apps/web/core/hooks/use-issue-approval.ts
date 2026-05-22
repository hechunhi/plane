/**
 * BARSOUL ADR-029 (改訂 2): 凍結カード判定 + 役割派生.
 *
 * **設計修正(重要)**: 元版は ai-bot endpoint を frozen 判定の真相源にした
 * が, 標籤こそが視覚層の生命周期信号(label がある間=ロック中, 消えれば
 * =解除). ghost 残留もロック対象(ai-bot 清掃漏れは別 bug, UI は忠実に
 * 標籤を尊重する). よって判定 = **label の有無**. endpoint は **役割
 * 情報の付加** のみ(best-effort, 失敗 = bystander フォールバック).
 *
 * 利点: API 呼出 0 で frozen 判定即時(性能◎); endpoint/ai-bot 不通時も
 * ロックは効く(可用性◎); 標籤生命周期 = 視覚生命周期 = ユーザ直感◎.
 */
import useSWR from "swr";
import { useLabel } from "@/hooks/store/use-label";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user/user-user";

// 標籤名称(ai-bot approval.MANAGED_LABEL と同期; 変更時両処注意).
const FROZEN_LABEL_NAMES = ["🔒審査託管中 / 流程托管中"];

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
    const r = await fetch(`/__approval/by-issue/${issueId}`, { credentials: "same-origin" });
    if (!r.ok) return { frozen: false };
    return (await r.json()) as TIssueApprovalData;
  } catch {
    return { frozen: false };
  }
};

export const useIssueApproval = (issueId: string | undefined) => {
  const { data: userData } = useUser();
  const myId = userData?.id;
  const { getLabelById } = useLabel();
  const {
    issue: { getIssueById },
  } = useIssueDetail();

  // ===== ① label-based frozen 判定 (SoR, 即時, 0 API 呼出) =====
  const issue = issueId ? getIssueById(issueId) : undefined;
  const labelIds = issue?.label_ids || [];
  const frozen = labelIds.some((lid) => {
    const l = getLabelById(lid);
    return l && FROZEN_LABEL_NAMES.includes(l.name);
  });

  // ===== ② role 付加情報 (best-effort, frozen 時のみ fetch) =====
  const { data: roleInfo, mutate } = useSWR<TIssueApprovalData>(
    frozen && issueId ? issueApprovalSWRKey(issueId) : null,
    issueId ? () => fetchIssueApproval(issueId) : null,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: 5 * 60_000,
    }
  );

  // ===== ③ myRole 派生 — endpoint があれば精細, 無ければ bystander 安全側 =====
  let myRole: TFrozenRole = "none";
  if (frozen) {
    myRole = "bystander"; // 既定: ロックは見えるが自分要対応か未知
    if (myId && roleInfo && roleInfo.frozen) {
      const me = roleInfo.approvers?.find((a) => a.id === myId);
      const isInitiator = roleInfo.initiator?.id === myId;
      if (me) {
        if (me.decided) {
          myRole = "bystander";
        } else if (roleInfo.mode === "SEQUENTIAL" && !me.is_current) {
          myRole = "queued_approver";
        } else {
          myRole = "pending_approver";
        }
      } else if (isInitiator) {
        myRole = "initiator";
      }
    }
  }

  return {
    /** 標籤の有無に基づく確定的判定. SoR. */
    frozen,
    /** 役割(endpoint 由来; 未読込/失敗時は bystander). */
    myRole,
    /** 詳細情報(無しでも frozen 有効). banner/tooltip 用. */
    approval: roleInfo,
    isMyTurn: myRole === "pending_approver",
    refresh: mutate,
  };
};
