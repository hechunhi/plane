/**
 * BARSOUL 審査受信箱の唯一の取得口 (hechun 2026-08-07)
 *
 * 「待我审批」は **「我的工作」** に、「我发起 / 全部 / 起票」は **審査台帳
 * (/approvals)** に置く。置き場は 2 つでも **取得と行の実装は 1 つ**——
 * それがこの hook。
 *
 * SWR キーは (slug, scope, status) —— 同じ切り口を 2 画面が同時に開いても
 * 1 回しか飛ばない。手書きの useState+useEffect に戻さないこと:
 * `useTranslation()` の `t` は locale 変更時に identity が変わるため、
 * 依存配列経由で effect に混ざると容易に取得ループになる(実害あり)。
 */
import useSWR from "swr";
import {
  approvalsService,
  type TApprovalInboxItem,
  type TApprovalScope,
  type TApprovalStatusFilter,
} from "@/services/approvals.service";

export const approvalInboxSWRKey = (
  workspaceSlug: string | undefined,
  scope: TApprovalScope,
  status: TApprovalStatusFilter
) => (workspaceSlug ? `APPROVAL_INBOX:${workspaceSlug}:${scope}:${status}` : null);

export function useApprovalInbox(
  workspaceSlug: string | undefined,
  scope: TApprovalScope,
  status: TApprovalStatusFilter
) {
  const { data, error, isLoading, mutate } = useSWR<TApprovalInboxItem[]>(
    approvalInboxSWRKey(workspaceSlug, scope, status),
    workspaceSlug ? () => approvalsService.list(workspaceSlug, scope, status) : null,
    { revalidateOnFocus: true, dedupingInterval: 30_000 }
  );

  return {
    items: data ?? [],
    // サーバが理由を返さない場合もあるので、文言は呼び出し側で t() する。
    errorMessage: error ? (error as { error?: string; msg?: string })?.error || (error as { msg?: string })?.msg : null,
    hasError: !!error,
    isLoading: isLoading && !data,
    refresh: () => void mutate(),
  };
}

/** 自分の裁決を待っている束。件数バッジも一覧もこれ 1 つから出す(ズレない)。 */
export const myPendingOf = (items: TApprovalInboxItem[]) => items.filter((x) => x.my_pending);
