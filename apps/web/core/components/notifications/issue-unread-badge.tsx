/**
 * BARSOUL: 課題カードの未読インジケータ。
 *
 * 設計方針（通知中心 /barsoul/notifications/ と視覚言語を完全統一）:
 *   - 色は `accent-primary` トークンのみ使用（テーマ追従。raw な bg-red-500
 *     等は Plane のトークン化 Tailwind で生成されず不可視になるため厳禁）。
 *   - A1: 未読の主種別で形/強度を分ける（対応必須ほど強い表現）:
 *       mention  … 実心ドット＋光暈＋"@"（あなた宛メンション・最優先）
 *       assigned … 実心ドット＋光暈（担当に指定）
 *       comment  … 実心ドット（新コメント）
 *       update   … 描边ドット（状態/ラベル等の軽微な更新）
 *   - A4: muted=true（已托管/已归档 等の状態）は一切描画しない＝ノイズ排除。
 *   - 件数はカードに出さず Tooltip に集約（UI ノイズ排除）。
 *   - カード本体(kanban/list block)は useIssueUnreadCount/Kind を読み、
 *     左端アクセントバー＋薄い底色を付与（Gmail/Linear 流の一覧判別）。
 *   - 判定ロジックは通知中心と同一: 未読 かつ 未アーカイブ かつ 未スヌーズ。
 */
import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Tooltip } from "@plane/propel/tooltip";
import type { TUnreadKind } from "@/store/notifications/workspace-notifications.store";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";

/** 該当 issue の未読件数（observer 配下で呼ぶこと＝reactive）。 */
export const useIssueUnreadCount = (issueId: string | undefined): number => {
  const { unreadCountByIssueId } = useWorkspaceNotifications();
  return issueId ? unreadCountByIssueId(issueId) : 0;
};

/** 該当 issue の未読主種別（A1）。 */
export const useIssueUnreadKind = (issueId: string | undefined): TUnreadKind => {
  const { unreadKindByIssueId } = useWorkspaceNotifications();
  return issueId ? unreadKindByIssueId(issueId) : "none";
};

/** 該当 issue に未読の「提醒」通知があるか（A3 看板紫呼吸点用）。 */
export const useIssueUnreadHasReminder = (issueId: string | undefined): boolean => {
  const { unreadHasReminderByIssueId } = useWorkspaceNotifications();
  return issueId ? unreadHasReminderByIssueId(issueId) : false;
};

/** 複数 issue（看板1カラム）の未読合計（A2 列ヘッダ集計）。 */
export const useGroupUnreadCount = (issueIds: string[]): number => {
  const { unreadCountForIssueIds } = useWorkspaceNotifications();
  return unreadCountForIssueIds(issueIds);
};

/** BARSOUL(2026-05-25): 指定 project に未読があるか(サイドバー赤点用)。 */
export const useHasUnreadInProject = (projectId: string | undefined): boolean => {
  const { unreadProjectIdSet } = useWorkspaceNotifications();
  return !!projectId && unreadProjectIdSet.has(projectId);
};

/** BARSOUL(2026-05-25): どこかに未読があるか(項目グループヘッダ用)。 */
export const useHasAnyUnread = (): boolean => {
  const { unreadProjectIdSet } = useWorkspaceNotifications();
  return unreadProjectIdSet.size > 0;
};

/** 共通 — サイドバー用の小さな red dot 点。 */
export const UnreadDot: React.FC<{ className?: string }> = ({ className }) => (
  <span
    aria-label="unread"
    className={`inline-block shrink-0 rounded-full ${className || "size-1.5"}`}
    style={{ background: "var(--bg-danger-primary)" }}
  />
);

/**
 * BARSOUL A4: 静默(免打扰)状態の判定。已托管/已归档/取消 等＝対応不要なので
 * カードを赤くしない（ノイズ排除）。状態名キーワード or state group で判定。
 * 必要に応じキーワードを足すだけで運用調整できる。
 */
export const isMutedState = (stateName?: string, _stateGroup?: string): boolean => {
  // BARSOUL v2(2026-05-25): 完了/取消 グループでの抑制を廃止。
  // 理由: ユーザ反饋 — Done に入った課題でも 復盤/補足 で再活性化、
  // 通知が来てる = 対応要、状態に関係なく見せる(BS-161 ケース)。
  // スヌーズ/アーカイブ済は通知ストア側で既にフィルタ → ここに残る = 真信号。
  // 残す muting: 名前に明示 归档/archived のもののみ(管理者意図的)。
  const n = stateName || "";
  if (/归档|歸檔|帰档|アーカイブ/.test(n)) return true;
  return /archiv/i.test(n);
};

type TIssueUnreadBadgeProps = {
  issueId: string | undefined;
  /** A4: 已托管/已归档 等 静默状態。true なら未読でも描画しない。 */
  muted?: boolean;
};

const KIND_TOOLTIP: Record<Exclude<TUnreadKind, "none">, (n: number) => string> = {
  mention: (n) => `@メンション ${n}件 / @提及 ${n}条（要対応）`,
  assigned: (n) => `担当に指定 ${n}件 / 指派给你 ${n}条`,
  comment: (n) => `新しいコメント ${n}件 / 新评论 ${n}条`,
  update: (n) => `更新 ${n}件 / 更新 ${n}条`,
  reminder: (n) => `提醒通知 ${n}件 / 提醒通知 ${n}条`,
};

export const IssueUnreadBadge = observer(function IssueUnreadBadge(props: TIssueUnreadBadgeProps) {
  const { issueId, muted = false } = props;
  const { workspaceSlug } = useParams();
  const { ensureBadgeNotifications } = useWorkspaceNotifications();
  const count = useIssueUnreadCount(issueId);
  const kind = useIssueUnreadKind(issueId);

  useEffect(() => {
    ensureBadgeNotifications((workspaceSlug || "").toString());
  }, [workspaceSlug, ensureBadgeNotifications]);

  // A4: 静默状態 or 未読なし → 何も描画しない
  if (muted || !count || kind === "none") return null;

  const hasHalo = kind === "mention" || kind === "assigned";
  const isOutline = kind === "update";

  const dot: React.CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 10,
    width: 10,
    borderRadius: 9999,
  };
  // BARSOUL(2026-05-25): danger/red トークンへ変更。
  // 旧 accent(青) → 「新メッセージ/通知」の業界标准色である red dot に統一。
  // Plane tailwind-config 既存トークン --bg-danger-primary (= --red-700)。
  const ACCENT = "var(--bg-danger-primary)";
  const filled: React.CSSProperties = isOutline
    ? { ...dot, background: "transparent", boxShadow: `inset 0 0 0 1.5px ${ACCENT}` }
    : { ...dot, background: ACCENT, color: "#fff", boxShadow: `0 0 0 1px ${ACCENT}` };

  return (
    <Tooltip tooltipContent={KIND_TOOLTIP[kind as Exclude<TUnreadKind, "none">](count)} isMobile={false}>
      <span
        aria-label={`${count} unread updates (${kind})`}
        className="relative ml-1.5 inline-flex h-2.5 w-2.5 flex-shrink-0 items-center justify-center align-middle"
      >
        {hasHalo && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ background: ACCENT }}
          />
        )}
        <span style={filled}>
          {kind === "mention" && <span style={{ fontSize: 7, fontWeight: 800, lineHeight: 1, color: "#fff" }}>@</span>}
        </span>
      </span>
    </Tooltip>
  );
});
