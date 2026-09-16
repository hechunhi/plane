/**
 * BARSOUL 2026-09-16 (hechun) — 通知を「カード単位」で描く流れ。
 *
 * 産品決定(hechun 2026-09-16):「同一张卡片的多操作,视觉上合并,但是分开每个都要可以点击直达」。
 *   - 見出し = カード(BS-448 + 題名 + プロジェクト)。押すとカードを開く。
 *   - その下に各動きが 1 行ずつ。**行ごとに**押すと該当コメント / 活動へ直達
 *     (peek + getNotificationAnchorId で定位)し、その行(と畳まれた分)だけ既読。
 *   - 3 段の重さ: コメント = 本文 2 行・主色 / 項目変更 = 小さく灰 / bot・自動 = さらに淡く。
 *   - 返信先が自分のコメント → 「回复了你」(accent 蓝 = 位置の意味、行動信号ではない)。
 *   - 日付セクション(今日 / 昨日 / 今週 / それ以前)で相対時刻の羅列をやめ、行は HH:mm。
 *
 * 畳み方は group.ts(純関数)。ここは描画と既読・遷移だけ。データ・既読の保存は通知 store のまま。
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { AlarmClock, CalendarClock, Repeat, Paperclip, Bot } from "lucide-react";
// plane imports
import { ENotificationLoader, ENotificationQueryParamType } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TNotification } from "@plane/types";
import { Tooltip } from "@plane/propel/tooltip";
import { Avatar } from "@plane/ui";
import { cn, getFileURL, sanitizeCommentForNotification } from "@plane/utils";
// hooks
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useTranslatedTitle, TitleTooltipContent } from "@/components/issues/translate/card-title-translate";
import { useTranslatedCommentSnippet } from "@/components/issues/translate/comment-snippet-translate";
import { TranslateGlyph } from "@/components/issues/translate/issue-field-translate";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { getNotificationAnchorId } from "@/lib/notification-anchor";
// local imports
import { NotificationContent } from "./content";
import { buildNotificationSections, type TNotificationGroup, type TNotificationRow, type TNotificationSectionKey } from "./group";
import { NotificationOption } from "./options";
import { NotificationTimeFooter } from "./time-footer";

type TProps = {
  workspaceSlug: string;
  workspaceId: string;
};

const SECTION_LABEL: Record<TNotificationSectionKey, { zh: string; ja: string }> = {
  today: { zh: "今天", ja: "今日" },
  yesterday: { zh: "昨天", ja: "昨日" },
  week: { zh: "本周更早", ja: "今週" },
  older: { zh: "更早", ja: "それ以前" },
};

const pad2 = (n: number) => String(n).padStart(2, "0");
/** 行の時刻。同じ日のセクションに居るので「HH:mm」で足りる。今週以前だけ M/d を添える。 */
const rowTime = (iso: string | undefined, section: TNotificationSectionKey) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return section === "today" || section === "yesterday" ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

const kindOf = (n: TNotification) => (n.data as { kind?: string } | undefined)?.kind;

export const NotificationGroupedList = observer(function NotificationGroupedList(props: TProps) {
  const { workspaceSlug, workspaceId } = props;
  const zh = useZh();
  const { t } = useTranslation();
  const { loader, paginationInfo, getNotifications, notificationIdsByWorkspaceId, notifications } =
    useWorkspaceNotifications();
  const { getWorkspaceBySlug } = useWorkspace();
  const workspace = getWorkspaceBySlug(workspaceSlug);
  const notificationIds = notificationIdsByWorkspaceId(workspaceId);

  // 畳みは id 列と各通知の read_at / created_at に依存。observer なので store 更新で再計算される。
  const sections = useMemo(() => {
    if (!notificationIds) return [];
    const list = notificationIds.map((id) => notifications[id]?.asJson).filter((n): n is TNotification => !!n?.id);
    return buildNotificationSections(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationIds, notifications, notificationIds?.map((id) => notifications[id]?.asJson?.read_at).join("|")]);

  const getNextNotifications = async () => {
    try {
      await getNotifications(workspaceSlug, ENotificationLoader.PAGINATION_LOADER, ENotificationQueryParamType.NEXT);
    } catch (error) {
      console.error(error);
    }
  };

  if (!workspaceSlug || !workspace?.id || !notificationIds) return <></>;

  return (
    <div>
      {sections.map((section) => (
        <div key={section.key}>
          <div className="sticky top-0 z-[3] border-b border-subtle bg-surface-1/95 px-4 py-1.5 text-11 font-medium text-tertiary backdrop-blur">
            {zh ? SECTION_LABEL[section.key].zh : SECTION_LABEL[section.key].ja}
          </div>
          {section.groups.map((group) => (
            <NotificationGroupCard
              key={group.key}
              group={group}
              section={section.key}
              workspaceSlug={workspaceSlug}
              workspaceId={workspace.id}
            />
          ))}
        </div>
      ))}

      {/* fetch next page notifications */}
      {paginationInfo && paginationInfo?.next_page_results && (
        <>
          {loader === ENotificationLoader.PAGINATION_LOADER ? (
            <div className="flex items-center justify-center py-4 text-13 font-medium">
              <div className="text-accent-secondary">{t("loading")}...</div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-4 text-13 font-medium" onClick={getNextNotifications}>
              <div className="cursor-pointer text-accent-secondary transition-all hover:text-accent-primary">
                {t("load_more")}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});

// ── カード(グループ) ───────────────────────────────────────────────────────

const NotificationGroupCard = observer(function NotificationGroupCard(props: {
  group: TNotificationGroup;
  section: TNotificationSectionKey;
  workspaceSlug: string;
  workspaceId: string;
}) {
  const { group, section, workspaceSlug, workspaceId } = props;
  const zh = useZh();
  const { getProjectById } = useProject();
  const { setPeekIssue, getIsIssuePeeked, setScrollToActivityCommentId } = useIssueDetail();
  const { notifications, setCurrentSelectedNotificationId } = useWorkspaceNotifications();
  const projectName = group.projectId ? getProjectById(group.projectId)?.name : undefined;
  // 件名は一覧カードと同じ表示翻訳(同じキャッシュ)。訳せない間は原文がそのまま返る。
  const cardTitle = useTranslatedTitle(group.issueId, group.name);

  /** 行(と畳まれた分)を既読へ。失敗しても遷移は止めない。 */
  const markRowsRead = async (rows: TNotificationRow[]) => {
    const ids = rows.flatMap((r) => [r.id, ...r.hiddenIds]);
    await Promise.all(
      ids.map(async (id) => {
        const n = notifications[id];
        if (!n?.asJson || n.asJson.read_at !== null) return;
        try {
          await n.markNotificationAsRead(workspaceSlug);
        } catch (e) {
          console.error(e);
        }
      })
    );
  };

  /** 見出し = カードを開く(定位なし)。グループ全体を既読に。 */
  const openIssue = async () => {
    if (!group.projectId || !group.issueId) return;
    // 行は古い→新しいなので、選択状態は末尾(最新)に付ける。
    const head = group.rows[group.rows.length - 1];
    if (!head) return;
    setPeekIssue(undefined);
    setCurrentSelectedNotificationId(head.id);
    void markRowsRead(group.rows);
    if (!getIsIssuePeeked(group.issueId)) {
      setPeekIssue({ workspaceSlug, projectId: group.projectId, issueId: group.issueId });
    }
  };

  /** 行 = その動きへ直達。その行だけ既読に。 */
  const openRow = async (row: TNotificationRow) => {
    const n = row.notification;
    if (!group.projectId || !group.issueId) return;
    setPeekIssue(undefined);
    setCurrentSelectedNotificationId(row.id);
    void markRowsRead([row]);
    if (n.is_inbox_issue === false || n.is_inbox_issue === undefined) {
      if (!getIsIssuePeeked(group.issueId)) {
        setPeekIssue({ workspaceSlug, projectId: group.projectId, issueId: group.issueId });
      }
      const target = getNotificationAnchorId(n.data?.issue_activity);
      if (target) setScrollToActivityCommentId(target);
    }
  };

  return (
    <div className="border-b border-subtle">
      <div
        className={cn("group/head flex cursor-pointer items-start gap-2 px-4 pt-3 pb-1", {
          "bg-accent-primary/5": group.unreadCount > 0,
        })}
        onClick={openIssue}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {group.identifier && (
              <span className="shrink-0 text-11 font-medium text-tertiary tabular-nums">{group.identifier}</span>
            )}
            <Tooltip tooltipContent={<TitleTooltipContent value={cardTitle} />} renderByDefault={false}>
              <span className="line-clamp-1 min-w-0 text-13 font-medium text-primary group-hover/head:text-accent-primary">
                {cardTitle.translated && (
                  <span className="mr-1 inline-flex translate-y-[1px] text-tertiary">
                    <TranslateGlyph />
                  </span>
                )}
                {cardTitle.title}
              </span>
            </Tooltip>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-11 text-tertiary">
            {projectName && <span className="line-clamp-1">{projectName}</span>}
            <NotificationTimeFooter
              workspaceSlug={workspaceSlug}
              projectId={group.projectId ?? ""}
              issueId={group.issueId}
            />
          </div>
        </div>
        {group.unreadCount > 0 && (
          <span className="mt-0.5 shrink-0 rounded-full bg-accent-primary/15 px-2 py-0.5 text-11 font-semibold text-accent-primary tabular-nums">
            {group.unreadCount}
          </span>
        )}
      </div>
      <div className="pb-2">
        {group.rows.map((row) => (
          <NotificationGroupRow
            key={row.id}
            row={row}
            section={section}
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            projectId={group.projectId ?? ""}
            onOpen={() => void openRow(row)}
            zh={zh}
          />
        ))}
      </div>
    </div>
  );
});

// ── 1 行(動き) ─────────────────────────────────────────────────────────────

const NotificationGroupRow = observer(function NotificationGroupRow(props: {
  row: TNotificationRow;
  section: TNotificationSectionKey;
  workspaceSlug: string;
  workspaceId: string;
  projectId: string;
  onOpen: () => void;
  zh: boolean;
}) {
  const { row, section, workspaceSlug, workspaceId, projectId, onOpen, zh } = props;
  const { data: currentUser } = useUser();
  const { currentSelectedNotificationId } = useWorkspaceNotifications();
  const [isSnoozeStateModalOpen, setIsSnoozeStateModalOpen] = useState(false);
  const [customSnoozeModal, setCustomSnoozeModal] = useState(false);

  const n = row.notification;
  const act = n.data?.issue_activity;
  const kind = kindOf(n);
  const by = n.triggered_by_details;
  const isBot = !!by?.is_bot;
  const isComment = act?.field === "comment";
  const isReplyToMe = !!act?.reply_to_actor && !!currentUser?.id && act.reply_to_actor === currentUser.id;
  const actorName = (isBot ? by?.first_name : by?.display_name) || by?.display_name || "";
  // コメント抜粋の表示翻訳(削除通知は id が無いので対象外 → 原文ロジックに落ちる)。
  const snippet = useTranslatedCommentSnippet(
    isComment && !kind && act?.verb !== "deleted" ? act?.new_identifier : undefined,
    act?.new_value,
    sanitizeCommentForNotification
  );

  // 3 段の重さ: コメント / 項目変更 / bot・自動
  const tone = isComment && !isBot && act?.verb !== "deleted" ? "comment" : isBot ? "bot" : "change";

  const renderAvatar = () => {
    if (kind === "reminder") return <AlarmClock className="h-3.5 w-3.5" style={{ color: "#7c5cff" }} />;
    if (kind === "deadline") return <CalendarClock className="h-3.5 w-3.5" style={{ color: "#b45309" }} />;
    if (kind === "recurring") return <Repeat className="h-3.5 w-3.5 text-tertiary" />;
    if (isBot) return <Bot className="h-3.5 w-3.5 text-tertiary" />;
    return (
      <Avatar
        name={by?.display_name || by?.first_name}
        src={getFileURL(by?.avatar_url ?? "")}
        size={22}
        shape="circle"
        className="bg-layer-1 text-11"
      />
    );
  };

  /** 束ねた行の文言。1 件なら通常の NotificationContent に任せる。 */
  const renderBatched = () => {
    const field = act?.field;
    const nameEl = <span className="font-medium text-primary">{actorName} </span>;
    if (field === "attachment") {
      const removed = act?.verb === "deleted";
      return (
        <>
          {nameEl}
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            {removed
              ? zh
                ? `删除了 ${row.batchSize} 个附件`
                : `添付 ${row.batchSize} 件を削除`
              : zh
                ? `上传了 ${row.batchSize} 个附件`
                : `添付 ${row.batchSize} 件を追加`}
          </span>
        </>
      );
    }
    if (field === "name") {
      return (
        <>
          {nameEl}
          {zh ? `改了 ${row.batchSize} 次名称 → ` : `名前を ${row.batchSize} 回変更 → `}
          <span className="font-medium text-primary">{act?.new_value}</span>
        </>
      );
    }
    if (field === "description") {
      return (
        <>
          {nameEl}
          {zh ? `更新了 ${row.batchSize} 次描述` : `本文を ${row.batchSize} 回更新`}
        </>
      );
    }
    // link / labels: 代表の文面 + 件数
    return (
      <>
        <NotificationContent notification={n} workspaceId={workspaceId} workspaceSlug={workspaceSlug} projectId={projectId} />
        <span className="text-tertiary"> ×{row.batchSize}</span>
      </>
    );
  };

  const renderBody = () => {
    if (row.batchSize > 1 && !kind) return renderBatched();
    if (isComment && !kind && act?.verb === "deleted") {
      // 削除通知は id も本文も残らない(new_identifier=null, new_value="None")→ 直達先が無い。
      return (
        <>
          <span className="font-medium text-primary">{actorName} </span>
          {zh ? "删除了一条评论" : "コメントを削除"}
        </>
      );
    }
    if (isComment && !kind) {
      return (
        <>
          <span className="font-medium text-primary">{actorName}</span>
          {isReplyToMe && (
            <span className="ml-1.5 inline-block rounded bg-accent-primary/15 px-1.5 py-px align-middle text-10 font-semibold text-accent-primary">
              {zh ? "回复了你" : "あなたへの返信"}
            </span>
          )}
          {row.editedLate && (
            <span className="ml-1.5 text-10 text-placeholder">{zh ? "已编辑" : "編集済み"}</span>
          )}
          <Tooltip
            tooltipContent={
              <TitleTooltipContent
                value={{ title: snippet.text, translated: snippet.translated, original: snippet.original }}
              />
            }
            renderByDefault={false}
            disabled={!snippet.translated}
          >
            <div className={cn("line-clamp-2 break-words whitespace-pre-line", isBot ? "text-tertiary" : "text-primary")}>
              {snippet.translated && (
                <span className="mr-1 inline-flex translate-y-[1px] text-tertiary">
                  <TranslateGlyph />
                </span>
              )}
              {snippet.text}
            </div>
          </Tooltip>
        </>
      );
    }
    return (
      <NotificationContent notification={n} workspaceId={workspaceId} workspaceSlug={workspaceSlug} projectId={projectId} />
    );
  };

  return (
    <div
      className={cn("group relative flex cursor-pointer items-start gap-2 px-4 py-1.5 transition-colors hover:bg-layer-1/60", {
        "bg-layer-1/30": currentSelectedNotificationId === row.id,
      })}
      onClick={(e) => {
        e.stopPropagation();
        if (!isSnoozeStateModalOpen && !customSnoozeModal) onOpen();
      }}
    >
      {row.unread && <div className="absolute top-[14px] left-1.5 h-1.5 w-1.5 rounded-full bg-accent-primary" />}
      <div className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-layer-1">
        {renderAvatar()}
      </div>
      <div
        className={cn("min-w-0 flex-1 leading-5", {
          "text-13 text-primary": tone === "comment",
          "text-12 text-secondary": tone === "change",
          "text-12 text-tertiary": tone === "bot",
        })}
      >
        {renderBody()}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden group-hover:block">
          <NotificationOption
            workspaceSlug={workspaceSlug}
            notificationId={row.id}
            isSnoozeStateModalOpen={isSnoozeStateModalOpen}
            setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
            customSnoozeModal={customSnoozeModal}
            setCustomSnoozeModal={setCustomSnoozeModal}
          />
        </span>
        <span className="text-11 text-placeholder tabular-nums">{rowTime(n.created_at, section)}</span>
      </div>
    </div>
  );
});
