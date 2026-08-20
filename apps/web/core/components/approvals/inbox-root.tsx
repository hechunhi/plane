/**
 * BARSOUL 2026-07-25 (hechun「審査を一等市民に·受信箱」) / 2026-08-07 分業見直し。
 *
 * ワークスペース級「審査」ビュー。**分業が変わった**:
 *   ・**待我审批**(今日決めるべき束)  → 「我的工作」の承認レンズ。**ここには置かない**。
 *   ・**我发起 / 全部 / 独立起票**     → この台帳ページ。追跡・監査・起票のための場所。
 * 「一等市民」= 毎日専用の入口を持つこと、ではなく **出るべき所に出る** こと。
 * 行(ApprovalInboxRow)と取得(useApprovalInbox)は両画面で共有 —— 実装は 1 つ。
 *
 * データは同源 Django 認証代理(actor は session 解析)経由の読取専用。
 * 裁決は行内から既存 /ai/decide-approval → Temporal に集約(engine 不変)。
 */
import { useState } from "react";
import { ArrowRight, Loader, Plus } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import { useApprovalInbox } from "@/hooks/use-approval-inbox";
import type { TApprovalScope, TApprovalStatusFilter } from "@/services/approvals.service";
import { ApprovalInboxRow } from "./inbox-row";
import { StandaloneApprovalModal } from "./standalone-modal";

type TTabKey = "mine" | "all";

const TABS: { key: TTabKey; scope: TApprovalScope; status: TApprovalStatusFilter }[] = [
  { key: "mine", scope: "mine", status: "all" },
  { key: "all", scope: "all", status: "all" },
];

type Props = { workspaceSlug: string };

export function ApprovalInboxRoot({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TTabKey>("mine");
  const [originating, setOriginating] = useState(false);

  const cfg = TABS.find((x) => x.key === tab)!;
  // 取得は SWR キー (slug, scope, status) 一本。手書きの useEffect ループに
  // 戻さないこと —— `t` を依存に混ぜて毎フレーム取得する事故が実際に起きた。
  const { items, hasError, errorMessage, isLoading, refresh } = useApprovalInbox(workspaceSlug, cfg.scope, cfg.status);

  const tabLabel = (key: TTabKey) => (key === "mine" ? t("approval_inbox.tab_mine") : t("approval_inbox.tab_all"));

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-5 py-5">
      {/* タブ(選択 = accent 蓝 = 位置/選中) */}
      <div className="flex items-center gap-1 border-b border-subtle">
        {TABS.map((x) => {
          const active = x.key === tab;
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-13 font-medium transition-colors",
                active
                  ? "border-accent-strong text-accent-primary"
                  : "border-transparent text-tertiary hover:text-secondary"
              )}
            >
              {tabLabel(x.key)}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            className="text-11 text-tertiary hover:text-secondary disabled:opacity-50"
          >
            {t("approval_inbox.refresh")}
          </button>
          {/* 独立(issue 無し)発起の入口。engine は工作项経路と共有。 */}
          <button
            type="button"
            onClick={() => setOriginating(true)}
            className="inline-flex items-center gap-1 rounded-md bg-accent-primary px-2.5 py-1 text-11 font-medium text-white hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t("approval_inbox.originate")}
          </button>
        </div>
      </div>

      {/* 決める場所への道標。ここは台帳なので、行動は「我的工作」へ送る。 */}
      <Link
        to={`/${workspaceSlug}/my-work/`}
        className="mt-3 mb-4 inline-flex w-fit items-center gap-1.5 text-11 text-tertiary transition-colors hover:text-accent-primary"
      >
        {t("approval_inbox.decide_moved_hint")}
        <ArrowRight className="size-3 shrink-0" strokeWidth={1.75} />
      </Link>

      {/* 本体 */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-16 text-tertiary">
          <Loader className="size-4 animate-spin" />
        </div>
      ) : hasError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-13 text-danger-primary">{errorMessage || t("approval_inbox.load_failed")}</p>
          <button type="button" onClick={refresh} className="text-12 text-accent-primary hover:underline">
            {t("approval_inbox.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
          <p className="text-13 text-secondary">{t("approval_inbox.empty_generic")}</p>
          <p className="text-11 text-tertiary">{t("approval_inbox.empty_hint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <ApprovalInboxRow key={item.no} item={item} workspaceSlug={workspaceSlug} onDecided={refresh} />
          ))}
        </div>
      )}

      {/* 独立審査の発起モーダル(台帳からのみ)。作成後は「我发起」を読み直す。 */}
      <StandaloneApprovalModal
        workspaceSlug={workspaceSlug}
        isOpen={originating}
        onClose={() => setOriginating(false)}
        onCreated={() => {
          setTab("mine");
          refresh();
        }}
      />
    </div>
  );
}
