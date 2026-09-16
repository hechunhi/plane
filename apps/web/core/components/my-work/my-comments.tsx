/**
 * BARSOUL 2026-09-16 (hechun) — 「我的工作」レンズ **自分のコメント**(我的评论)。
 *
 * 動機(用户原話): 「我评论了以后,还是挺需要一个我评论的 timeline,方便我追踪我回复的任务」。
 * 動態は「他人が私に何をしたか」。ここは逆で「私が最後に口を出したカード」を時系列で辿り、
 * その後 **誰か返したか / まだ誰も返していないか** を 1 行で見せる。
 *
 * 見た目は動態のグループ表示(grouped-list)と同じ骨格 —— カード見出し + 行。
 * 別物に見えたら二重実装に戻っている。読み取り専用の投影、SoR 不触。
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Tooltip } from "@plane/propel/tooltip";
import { Avatar } from "@plane/ui";
import { cn, getFileURL, sanitizeCommentForNotification } from "@plane/utils";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useTranslatedTitle, TitleTooltipContent } from "@/components/issues/translate/card-title-translate";
import { useTranslatedCommentSnippet } from "@/components/issues/translate/comment-snippet-translate";
import { TranslateGlyph } from "@/components/issues/translate/issue-field-translate";
import { NotificationsLoader } from "@/components/workspace-notifications/sidebar/loader";
import {
  sectionKeyOf,
  type TNotificationSectionKey,
} from "@/components/workspace-notifications/sidebar/notification-card/group";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";

const PAGE = 60;

export type TMyCommentReply = {
  id: string;
  actor_display: string;
  actor_avatar: string;
  comment_html: string;
  created_at: string;
};

export type TMyCommentItem = {
  id: string;
  issue_id: string;
  project_id: string;
  project_identifier: string;
  sequence_id: number;
  issue_name: string;
  comment_html: string;
  created_at: string;
  reply: TMyCommentReply | null;
  is_last: boolean;
};

type TResp = { items: TMyCommentItem[]; has_more: boolean };

const jsonGet = async (url: string): Promise<TResp> => {
  const r = await fetch(url, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<TResp>;
};

// 動態(grouped-list)と同じ語・同じ時刻書式。export されていないので同文で持つ。
const SECTION_LABEL: Record<TNotificationSectionKey, { zh: string; ja: string }> = {
  today: { zh: "今天", ja: "今日" },
  yesterday: { zh: "昨天", ja: "昨日" },
  week: { zh: "本周更早", ja: "今週" },
  older: { zh: "更早", ja: "それ以前" },
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const rowTime = (iso: string | undefined, section: TNotificationSectionKey) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return section === "today" || section === "yesterday" ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

/** 連続する同一カードを 1 グループに(動態と同じ規則)。グループ内は古い→新しい。 */
type TGroup = { key: string; issueId: string; projectId: string; identifier: string; name: string; items: TMyCommentItem[]; latestAt: string };
type TSection = { key: TNotificationSectionKey; groups: TGroup[] };

const buildSections = (items: TMyCommentItem[], now = new Date()): TSection[] => {
  const groups: TGroup[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.issueId === it.issue_id) {
      last.items.push(it);
      continue;
    }
    groups.push({
      key: it.id,
      issueId: it.issue_id,
      projectId: it.project_id,
      identifier: `${it.project_identifier}-${it.sequence_id}`,
      name: it.issue_name,
      items: [it],
      latestAt: it.created_at,
    });
  }
  for (const g of groups) g.items.reverse();
  const sections: TSection[] = [];
  for (const g of groups) {
    const key = sectionKeyOf(g.latestAt, now);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.groups.push(g);
    else sections.push({ key, groups: [g] });
  }
  return sections;
};

export const MyCommentsTimeline = observer(function MyCommentsTimeline({ workspaceSlug }: { workspaceSlug: string }) {
  const zh = useZh();
  const [limit, setLimit] = useState(PAGE);
  // offset ではなく limit を伸ばす(1 本の SWR キー)→ 「もっと見る」で上が消えない。
  const { data, isLoading, isValidating } = useSWR<TResp>(
    workspaceSlug ? `/api/workspaces/${workspaceSlug}/my-comments/?offset=0&limit=${limit}` : null,
    jsonGet,
    { revalidateOnFocus: true, keepPreviousData: true }
  );
  const items = data?.items ?? [];
  const sections = useMemo(() => buildSections(items), [items]);

  if (isLoading && !data) return <NotificationsLoader />;
  if (!items.length)
    return <p className="px-6 py-16 text-center text-12 text-placeholder">{zh ? "你还没有评论过" : "まだコメントしていません"}</p>;

  return (
    <div>
      {sections.map((section) => (
        <div key={section.key}>
          <div className="sticky top-0 z-[3] border-b border-subtle bg-surface-1/95 px-4 py-1.5 text-11 font-medium text-tertiary backdrop-blur">
            {zh ? SECTION_LABEL[section.key].zh : SECTION_LABEL[section.key].ja}
          </div>
          {section.groups.map((g) => (
            <MyCommentGroup key={g.key} group={g} section={section.key} workspaceSlug={workspaceSlug} zh={zh} />
          ))}
        </div>
      ))}
      {data?.has_more && (
        <div className="flex items-center justify-center py-4 text-13 font-medium">
          <button
            type="button"
            className="cursor-pointer text-accent-secondary transition-all hover:text-accent-primary disabled:opacity-60"
            disabled={isValidating}
            onClick={() => setLimit((n) => n + PAGE)}
          >
            {isValidating ? (zh ? "加载中…" : "読み込み中…") : zh ? "加载更多" : "もっと見る"}
          </button>
        </div>
      )}
    </div>
  );
});

// ── 1 枚のカード(見出し + 自分のコメント行 + 返信行) ───────────────────────

const MyCommentGroup = observer(function MyCommentGroup(props: {
  group: TGroup;
  section: TNotificationSectionKey;
  workspaceSlug: string;
  zh: boolean;
}) {
  const { group, section, workspaceSlug, zh } = props;
  const { setPeekIssue, setScrollToActivityCommentId } = useIssueDetail();
  const { getProjectById } = useProject();
  const projectName = getProjectById(group.projectId)?.name;
  const cardTitle = useTranslatedTitle(group.issueId, group.name);

  const open = (commentId?: string) => {
    setPeekIssue({ workspaceSlug, projectId: group.projectId, issueId: group.issueId });
    if (commentId) setScrollToActivityCommentId(`ac-${commentId}`);
  };

  return (
    <div className="border-b border-subtle">
      <div className="group/head flex cursor-pointer items-start gap-2 px-4 pt-3 pb-1" onClick={() => open()}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-11 font-medium text-tertiary tabular-nums">{group.identifier}</span>
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
          {projectName && <div className="mt-0.5 line-clamp-1 text-11 text-tertiary">{projectName}</div>}
        </div>
      </div>
      <div className="pb-2">
        {group.items.map((it, i) => (
          <MyCommentRow key={it.id} item={it} section={section} zh={zh} onOpen={open} isLastInGroup={i === group.items.length - 1} />
        ))}
      </div>
    </div>
  );
});

// ── 自分のコメント 1 行(+ 直後の返信 1 行) ──────────────────────────────

const MyCommentRow = observer(function MyCommentRow(props: {
  item: TMyCommentItem;
  section: TNotificationSectionKey;
  zh: boolean;
  onOpen: (commentId?: string) => void;
  isLastInGroup: boolean;
}) {
  const { item, section, zh, onOpen, isLastInGroup } = props;
  const { data: me } = useUser();
  const mine = useTranslatedCommentSnippet(item.id, item.comment_html, sanitizeCommentForNotification);
  const reply = item.reply;
  const theirs = useTranslatedCommentSnippet(reply?.id, reply?.comment_html, sanitizeCommentForNotification);

  const snippetEl = (s: typeof mine, tone: string) => (
    <Tooltip
      tooltipContent={<TitleTooltipContent value={{ title: s.text, translated: s.translated, original: s.original }} />}
      renderByDefault={false}
      disabled={!s.translated}
    >
      <div className={cn("line-clamp-2 break-words whitespace-pre-line", s.text.trim() ? tone : "text-placeholder")}>
        {s.translated && (
          <span className="mr-1 inline-flex translate-y-[1px] text-tertiary">
            <TranslateGlyph />
          </span>
        )}
        {/* 画像・添付だけのコメントは本文が空になる(sanitize が img を落とす)→ 空行より中身の種類を出す */}
        {s.text.trim() || (zh ? "（图片 / 附件）" : "（画像・添付）")}
      </div>
    </Tooltip>
  );

  return (
    <>
      <div
        className="group flex cursor-pointer items-start gap-2 px-4 py-1.5 transition-colors hover:bg-layer-1/60"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(item.id);
        }}
      >
        <div className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-layer-1">
          <Avatar
            name={me?.display_name || me?.first_name}
            src={getFileURL(me?.avatar_url ?? "")}
            size={22}
            shape="circle"
            className="bg-layer-1 text-11"
          />
        </div>
        <div className="min-w-0 flex-1 text-13 leading-5 text-primary">
          <span className="font-medium text-primary">{zh ? "我" : "自分"}</span>
          {snippetEl(mine, "text-primary")}
        </div>
        <span className="shrink-0 text-11 text-placeholder tabular-nums">{rowTime(item.created_at, section)}</span>
      </div>

      {/* 返信の有無は、グループ内で最後の自分のコメントにだけ添える(途中の行はその次の自分の行が答え)。 */}
      {isLastInGroup &&
        (reply ? (
          <div
            className="group flex cursor-pointer items-start gap-2 px-4 py-1.5 transition-colors hover:bg-layer-1/60"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(reply.id);
            }}
          >
            <div className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-layer-1">
              <Avatar
                name={reply.actor_display}
                src={getFileURL(reply.actor_avatar)}
                size={22}
                shape="circle"
                className="bg-layer-1 text-11"
              />
            </div>
            <div className="min-w-0 flex-1 text-13 leading-5 text-primary">
              <span className="font-medium text-primary">{reply.actor_display}</span>
              <span className="ml-1.5 inline-block rounded bg-accent-primary/15 px-1.5 py-px align-middle text-10 font-semibold text-accent-primary">
                {zh ? "已回复" : "返信あり"}
              </span>
              {snippetEl(theirs, "text-primary")}
            </div>
            <span className="shrink-0 text-11 text-placeholder tabular-nums">{rowTime(reply.created_at, section)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-1 pl-[46px] text-11 text-placeholder">
            {zh ? "还没有人回复" : "まだ返信なし"}
          </div>
        ))}
    </>
  );
});
