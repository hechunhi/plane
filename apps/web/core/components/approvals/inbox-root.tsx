/**
 * BARSOUL 2026-07-25 (hechun「審査を一等市民に·受信箱」): ワークスペース級
 * 「審査」ビューの本体。3 タブ(待我处理 / 我发起 / 全部)で、自分が関与する
 * 審査を一望する。これが同時に:
 *   ① 既存の issue 紐付き審査に **集約された行き先** を与え、
 *   ② issue を持たない「独立」審査の **落脚点** になる。
 *
 * データは同源 Django 認証代理(actor は session 解析)経由の読取専用。
 * 裁決は行内から既存 /ai/decide-approval → Temporal に集約(engine 不変)。
 */
import { useCallback, useEffect, useState } from "react";
import { Loader, Plus } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import {
  approvalsService,
  type TApprovalInboxItem,
  type TApprovalScope,
  type TApprovalStatusFilter,
} from "@/services/approvals.service";
import { ApprovalInboxRow } from "./inbox-row";
import { StandaloneApprovalModal } from "./standalone-modal";

type TTabKey = "assigned" | "mine" | "all";

// タブ → (scope, status)。待我处理 = 自分が審査者 × 未終結のみ(＝決めるべき束)。
const TABS: { key: TTabKey; scope: TApprovalScope; status: TApprovalStatusFilter }[] = [
  { key: "assigned", scope: "assigned", status: "open" },
  { key: "mine", scope: "mine", status: "all" },
  { key: "all", scope: "all", status: "all" },
];

type Props = { workspaceSlug: string };

export function ApprovalInboxRoot({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TTabKey>("assigned");
  const [items, setItems] = useState<TApprovalInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [originating, setOriginating] = useState(false);

  const load = useCallback(
    async (key: TTabKey) => {
      const cfg = TABS.find((x) => x.key === key)!;
      setLoading(true);
      setError(null);
      try {
        const list = await approvalsService.list(workspaceSlug, cfg.scope, cfg.status);
        setItems(list);
      } catch (e) {
        const msg = (e as { error?: string; msg?: string })?.error || (e as { msg?: string })?.msg || "";
        setError(msg || t("approval_inbox.load_failed"));
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [workspaceSlug, t]
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const tabLabel = (key: TTabKey) =>
    key === "assigned"
      ? t("approval_inbox.tab_assigned")
      : key === "mine"
        ? t("approval_inbox.tab_mine")
        : t("approval_inbox.tab_all");

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-5 py-5">
      {/* タブ(選択 = accent 蓝 = 位置/選中) */}
      <div className="mb-4 flex items-center gap-1 border-b border-subtle">
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
            onClick={() => void load(tab)}
            disabled={loading}
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

      {/* 本体 */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16 text-tertiary">
          <Loader className="size-4 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-13 text-danger-primary">{error}</p>
          <button type="button" onClick={() => void load(tab)} className="text-12 text-accent-primary hover:underline">
            {t("approval_inbox.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
          <p className="text-13 text-secondary">
            {tab === "assigned" ? t("approval_inbox.empty_assigned") : t("approval_inbox.empty_generic")}
          </p>
          <p className="text-11 text-tertiary">{t("approval_inbox.empty_hint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <ApprovalInboxRow
              key={item.no}
              item={item}
              workspaceSlug={workspaceSlug}
              onDecided={() => void load(tab)}
            />
          ))}
        </div>
      )}

      {/* 独立審査の発起モーダル(受信箱からのみ)。作成後は現タブを読み直す。 */}
      <StandaloneApprovalModal
        workspaceSlug={workspaceSlug}
        isOpen={originating}
        onClose={() => setOriginating(false)}
        onCreated={() => {
          // 発起直後は「我発起」に切り替えて、作った独立審査を即見せる。
          setTab("mine");
          void load("mine");
        }}
      />
    </div>
  );
}
