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

export type TApprovalHistoryRow = {
  no: string;
  subject: string;
  status: string; // 通过 | 却下 | 撤回
  approvers: string[];
  finalized_at: string | null;
};

export type TIssueApprovalData = {
  frozen: boolean;
  no?: string;
  subject?: string;
  status?: string;
  mode?: "ALL" | "ANY" | "SEQUENTIAL";
  initiator?: { id: string; name: string };
  approvers?: TApprover[];
  history?: TApprovalHistoryRow[]; // B-2f: 終結済審査(評論流水廃止 → UI 表示面)
};

export type TFrozenRole =
  | "pending_approver"
  | "queued_approver"
  | "initiator"
  | "bystander"
  | "none";

export const issueApprovalSWRKey = (issueId: string) => `ISSUE_APPROVAL:${issueId}`;

// B-5a: 審査軽カード名の尾碼 = FNV-1a(No) 6hex(Go 側 shortNo と同一アルゴリズム)。
// 同父複数審査の取り違い防止(parent fallback は created_at DESC LIMIT 1 のため)。
export const approvalShortNo = (no: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < no.length; i++) {
    h ^= no.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0xffffff).toString(16).padStart(6, "0");
};

const TODO_CARD_PREFIX = "審査: "; // approval workflow CreateTodoCard と同期

const fetchIssueApproval = async (issueId: string, parentId?: string): Promise<TIssueApprovalData> => {
  try {
    // B-5a: 審査軽カードは label 無し&PG レコードは親(被審査カード)に紐付く
    // → ?parent= で ai-bot が親で再検索(軽カード上でその場裁決可能に)。
    const qs = parentId ? `?parent=${parentId}` : "";
    const r = await fetch(`/__approval/by-issue/${issueId}${qs}`, { credentials: "same-origin" });
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
  const labelFrozen = labelIds.some((lid) => {
    const l = getLabelById(lid);
    return l && FROZEN_LABEL_NAMES.includes(l.name);
  });

  // ===== ② role 付加情報 + 審査履歴 (best-effort) =====
  // B-2f: 評論流水廃止 → 履歴も本 endpoint が表示面。frozen でなくても
  // issue を開けば fetch(本地 PG 1 クエリ + SWR 30s dedupe で安価)。
  // B-5a: parent fallback は審査軽カード(名前が「審査: 」前缀)のみ発動 —
  // 兄弟站カード全部にバナーが湧くのを防ぐ(挙動は旧来と完全互換)。
  const todoParentId =
    issue?.name?.startsWith(TODO_CARD_PREFIX) && issue?.parent_id ? issue.parent_id : undefined;
  const { data: roleInfo, mutate } = useSWR<TIssueApprovalData>(
    issueId ? `${issueApprovalSWRKey(issueId)}:${todoParentId ?? ""}` : null,
    issueId ? () => fetchIssueApproval(issueId, todoParentId) : null,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: 5 * 60_000,
    }
  );

  // B-5a: 軽カード上の frozen = データ命中(label は親に在る)。尾碼 #hash6 で
  // 「この軽カードの審査」かを照合(同父複数審査の取り違い防止)。
  const viaParent = !labelFrozen && !!todoParentId && !!roleInfo?.frozen;
  const todoMatch = viaParent && !!roleInfo?.no && !!issue?.name?.endsWith(`#${approvalShortNo(roleInfo.no)}`);
  const frozen = labelFrozen || (viaParent && todoMatch);

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
    /** 標籤の有無に基づく確定的判定(B-5a: 軽カードはデータ命中+尾碼照合). */
    frozen,
    /** 役割(endpoint 由来; 未読込/失敗時は bystander). */
    myRole,
    /** 詳細情報(無しでも frozen 有効). banner/tooltip 用.
     *  B-5a: parent fallback 命中だが尾碼不一致(=別の審査)はデータを出さない. */
    approval: viaParent && !todoMatch ? undefined : roleInfo,
    isMyTurn: myRole === "pending_approver",
    refresh: mutate,
  };
};
