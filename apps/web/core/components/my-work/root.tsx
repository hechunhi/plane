/**
 * BARSOUL「我的工作」— 個人の作業入口 (hechun 2026-07-25)
 *
 * 産品決定 2026-07-25:**通知センターを別実装で作り直さない**。
 *   「動態 / @我」= 通知センターの store とカードをそのまま流用(NotificationListRoot)。
 *   増強はその上に **レンズ** を足すだけ — 通知が答えられない
 *   「で、私は何をすればいい?」に、球/情報不足/承認/期限/担当 で答える。
 * レンズを切り替えても**行の見た目は 1 つ**(WorkCard)。別物に見えたら二重実装に戻っている。
 *
 * 全部読み取り専用の投影。DIS も承認台帳も、ここからは書かない。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, AtSign, CircleHelp, Inbox, Reply, ShieldCheck, UserCheck } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { ENotificationLoader, ENotificationQueryParamType, ENotificationTab } from "@plane/constants";
import { cn } from "@plane/utils";
import { NotificationsLoader } from "@/components/workspace-notifications/sidebar/loader";
import { NotificationSidebarHeaderOptions } from "@/components/workspace-notifications/sidebar/header/options";
import { useMyWorkSources, type TWorkAssignedItem, type TWorkDigestItem } from "@/hooks/use-my-work-sources";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { NotificationListRoot } from "@/plane-web/components/workspace-notifications/list-root";
import { ApprovalInboxRow } from "@/components/approvals/inbox-row";
import { dueInfo, isMyBall, pick, useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { WorkCard } from "./work-card";

type Lens = "feed" | "mention" | "need" | "gap" | "approval" | "overdue" | "assigned";

/** urgent = 「私が動かないと止まる」列。数が 0 でない時だけ琥珀で灯す(琥珀は行動信号専用)。 */
const LENSES: { key: Lens; label: { zh: string; ja: string }; icon: typeof Inbox; urgent?: boolean }[] = [
  { key: "feed", label: { zh: "动态", ja: "動き" }, icon: Inbox },
  { key: "mention", label: { zh: "@我", ja: "@自分" }, icon: AtSign, urgent: true },
  { key: "need", label: { zh: "待我回球", ja: "自分の番" }, icon: Reply, urgent: true },
  { key: "gap", label: { zh: "需补充", ja: "情報不足" }, icon: CircleHelp, urgent: true },
  { key: "approval", label: { zh: "待审批", ja: "承認待ち" }, icon: ShieldCheck, urgent: true },
  { key: "overdue", label: { zh: "逾期", ja: "期限超過" }, icon: AlarmClock, urgent: true },
  { key: "assigned", label: { zh: "指派给我", ja: "自分の担当" }, icon: UserCheck },
];

const isOverdue = (target?: string | null) => dueInfo(target ?? null, true)?.tone === "overdue";

const emptyLine = (text: string) => <p className="px-6 py-16 text-center text-12 text-placeholder">{text}</p>;

export const MyWorkRoot = observer(function MyWorkRoot({ workspaceSlug }: { workspaceSlug: string }) {
  const zh = useZh();
  const { currentWorkspace } = useWorkspace();
  // 個人スコープの素。ball(= 会社単位)だけで絞ると同僚のカードが流れ込む。
  const { data: currentUser } = useUser();
  const myId = currentUser?.id;
  const myName = (currentUser?.display_name || "").trim() || undefined;
  const { setPeekIssue } = useIssueDetail();
  const { getProjectById } = useProject();
  const {
    loader,
    getNotifications,
    notificationIdsByWorkspaceId,
    unreadNotificationsCount,
    currentNotificationTab,
    setCurrentNotificationTab,
  } = useWorkspaceNotifications();
  const { digest, assigned, approvals, isLoading } = useMyWorkSources(workspaceSlug);

  const [lens, setLens] = useState<Lens>("feed");

  // 通知の取得は通知センターと同じ 1 本(SWR キーも同じ)→ 二度引きしない。
  const workspaceId = currentWorkspace?.id;
  const hasNotifications = workspaceId ? !!notificationIdsByWorkspaceId(workspaceId) : false;
  useSWR(
    workspaceSlug ? `WORKSPACE_NOTIFICATION_${workspaceSlug}` : null,
    workspaceSlug
      ? () =>
          getNotifications(
            workspaceSlug,
            hasNotifications ? ENotificationLoader.MUTATION_LOADER : ENotificationLoader.INIT_LOADER,
            hasNotifications ? ENotificationQueryParamType.CURRENT : ENotificationQueryParamType.INIT
          )
      : null
  );

  // 「@我」は通知センターの mentions タブそのもの。別の端点を叩かない。
  // setCurrentNotificationTab は無条件に一覧を捨てて引き直すので、同じ値なら呼ばない
  // (呼ぶと開いた瞬間に既に持っている通知を捨てて空白 → 再取得、という無駄が出る)。
  useEffect(() => {
    const tab = lens === "mention" ? ENotificationTab.MENTIONS : lens === "feed" ? ENotificationTab.ALL : null;
    if (tab && tab !== currentNotificationTab) setCurrentNotificationTab(tab);
  }, [lens, currentNotificationTab, setCurrentNotificationTab]);

  // ★ ball は **会社単位**(SELF = 自社の番)であって「私の番」ではない。ここで ball だけ
  //    見ると同僚が抱えているカードまで自分の列に入る(実測: 17 件中 14 件が他人の番)。
  //    人単位の判定は isMyBall に一本化する。
  const need = useMemo(() => digest.filter((d) => isMyBall(d, myId, myName)), [digest, myId, myName]);
  // 「需补充」も個人の列。ただし **完了カードでは ball / state が消える**(_dis_normalize)ので
  //    ball では絞れない。行動人 actor_user_id、無ければ担当者 owner(連結名)で見る。
  const gap = useMemo(
    () =>
      digest.filter((d) => {
        if (!d.needs_info) return false;
        if (d.actor_user_id) return !!myId && d.actor_user_id === myId;
        return !!myName && !!d.owner && d.owner.includes(myName);
      }),
    [digest, myId, myName]
  );
  const overdue = useMemo(() => assigned.filter((a) => isOverdue(a.target_date)), [assigned]);
  // 既に「自分の裁決待ち」だけに絞られている(use-my-work-sources の myPendingOf)。
  // ここで issue 紐づきを条件に足さないこと —— 独立審査が黙って消える。
  const approvalItems = approvals.items;

  const countOf = (k: Lens): number => {
    switch (k) {
      case "feed":
        return unreadNotificationsCount?.total_unread_notifications_count || 0;
      case "mention":
        return unreadNotificationsCount?.mention_unread_notifications_count || 0;
      case "need":
        return need.length;
      case "gap":
        return gap.length;
      case "approval":
        return approvalItems.length;
      case "overdue":
        return overdue.length;
      case "assigned":
        return assigned.length;
    }
  };

  const openIssue = (projectId: string, issueId: string) => setPeekIssue({ workspaceSlug, projectId, issueId });
  const idOf = (projectId: string, seq?: number | null, fallback?: string) => {
    const ident = fallback || getProjectById(projectId)?.identifier || "";
    return seq ? `${ident}-${seq}` : ident;
  };

  const digestRow = (d: TWorkDigestItem, kind: "need" | "gap") => (
    <WorkCard
      key={d.issue_id}
      workspaceSlug={workspaceSlug}
      projectId={d.project_id}
      issueId={d.issue_id}
      icon={
        kind === "need" ? (
          <Reply className="size-5 text-warning-primary" strokeWidth={1.75} />
        ) : (
          <CircleHelp className="size-5 text-warning-primary" strokeWidth={1.75} />
        )
      }
      iconClassName="bg-warning-subtle"
      title={pick(kind === "need" ? d.next_action : d.info_gap, zh) || d.name}
      subtitle={`${idOf(d.project_id, d.sequence_id, d.project_identifier)} ${d.name}`}
      meta={d.due_date ? dueInfo(d.due_date, zh)?.label : undefined}
      onClick={() => openIssue(d.project_id, d.issue_id)}
    />
  );

  const assignedRow = (a: TWorkAssignedItem) => {
    const late = isOverdue(a.target_date);
    return (
      <WorkCard
        key={a.issue_id}
        workspaceSlug={workspaceSlug}
        projectId={a.project_id}
        issueId={a.issue_id}
        icon={
          late ? (
            <AlarmClock className="size-5 text-warning-primary" strokeWidth={1.75} />
          ) : (
            <UserCheck className="size-5 text-tertiary" strokeWidth={1.75} />
          )
        }
        iconClassName={late ? "bg-warning-subtle" : undefined}
        title={a.name}
        subtitle={idOf(a.project_id, a.sequence_id)}
        meta={a.target_date ? dueInfo(a.target_date, zh)?.label : undefined}
        onClick={() => openIssue(a.project_id, a.issue_id)}
      />
    );
  };

  const stream = () => {
    if (lens === "feed" || lens === "mention") {
      if (loader === ENotificationLoader.INIT_LOADER) return <NotificationsLoader />;
      if (!workspaceId || !notificationIdsByWorkspaceId(workspaceId)?.length)
        return emptyLine(zh ? "没有新的动态" : "新しい動きはありません");
      return <NotificationListRoot workspaceSlug={workspaceSlug} workspaceId={workspaceId} />;
    }

    if (lens === "approval" && approvals.isLoading && !approvalItems.length) return <NotificationsLoader />;
    if (lens !== "approval" && isLoading && !digest.length && !assigned.length) return <NotificationsLoader />;

    if (lens === "need")
      return need.length
        ? need.map((d) => digestRow(d, "need"))
        : emptyLine(zh ? "球不在你这边" : "あなたの番のカードはありません");
    if (lens === "gap")
      return gap.length
        ? gap.map((d) => digestRow(d, "gap"))
        : emptyLine(zh ? "没有待补充的卡片" : "情報不足のカードはありません");
    if (lens === "overdue")
      return overdue.length ? overdue.map(assignedRow) : emptyLine(zh ? "没有逾期" : "期限超過はありません");
    if (lens === "assigned")
      return assigned.length
        ? assigned.map(assignedRow)
        : emptyLine(zh ? "没有指派给你的卡片" : "担当のカードはありません");

    // 承認だけは課題ではなく申請 —— 見るだけでは終わらず **決める** 必要がある。
    // だから WorkCard(流の行)ではなく、裁決 UI を持つ ApprovalInboxRow をそのまま
    // 使う(/approvals と同一実装)。見た目が違うのは意図的: ここは押す場所。
    return approvalItems.length ? (
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {approvalItems.map((i) => (
          <ApprovalInboxRow key={i.no} item={i} workspaceSlug={workspaceSlug} onDecided={approvals.refresh} />
        ))}
      </div>
    ) : (
      emptyLine(zh ? "没有待你审批的申请" : "承認待ちはありません")
    );
  };

  return (
    // 外枠(layout の ContentWrapper)が既にスクロール担当。ここで二重に巻かない。
    <div className="flex w-full flex-col">
      {/* レンズ。狭い画面では横に流す — 畳んで隠すと「何が見られるか」が判らなくなる。
          流と一緒に上へ張り付く: どの視点を見ているかは、スクロール中こそ見失う。 */}
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-subtle bg-surface-1 px-4 py-2">
        <div className="horizontal-scrollbar flex scrollbar-sm min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {LENSES.map((l) => {
            const n = countOf(l.key);
            const on = lens === l.key;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => setLens(l.key)}
                aria-pressed={on}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-12 whitespace-nowrap transition-colors",
                  on
                    ? "border-accent-strong bg-accent-subtle font-medium text-accent-primary"
                    : "border-transparent text-secondary hover:bg-layer-1 hover:text-primary"
                )}
              >
                <l.icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                {zh ? l.label.zh : l.label.ja}
                {n > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-11 tabular-nums",
                      l.urgent ? "bg-warning-subtle text-warning-primary" : "bg-layer-1 text-tertiary"
                    )}
                  >
                    {n > 99 ? "99+" : n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 全部既読 / 再取得 / 絞り込み は通知の操作。通知を見ている時だけ出す。 */}
        {(lens === "feed" || lens === "mention") && (
          <div className="shrink-0 border-l border-subtle pl-2">
            <NotificationSidebarHeaderOptions workspaceSlug={workspaceSlug} />
          </div>
        )}

        {/* 2026-08-07:「審査」のサイドバー入口を廃止したので、台帳(我发起/全部/起票)
            への唯一の導線がここ。裁決は左の一覧で終わる、追跡だけ台帳へ。 */}
        {lens === "approval" && (
          <Link
            href={`/${workspaceSlug}/approvals/`}
            className="shrink-0 border-l border-subtle pl-2 text-11 whitespace-nowrap text-tertiary transition-colors hover:text-accent-primary"
          >
            {zh ? "审批台账" : "審査台帳"}
          </Link>
        )}
      </div>

      <div className="mx-auto w-full max-w-[54rem]">{stream()}</div>
    </div>
  );
});
