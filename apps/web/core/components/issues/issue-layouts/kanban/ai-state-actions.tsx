/**
 * BARSOUL DIS v11: 卡片当前态「行动操作」。构思后精简(2026-06-15,用户反馈):
 *  - 催促 = **以 愛ちゃん(AI 用户)名义**发评论 + @ 当前行动人(球在谁手)。管理者点击=授权,
 *    内容由爱酱发出(走 plane-api `.../ai-state/urge/` → actor=愛ちゃん)。比「以你本人发」更自然。
 *  - **去掉「改担当」**:改 SoR 负责人在卡片上原生就能做,这里重复;纠正 AI 的结论由
 *    「向 AI 补充/纠正」表单 + 再分析 承担。模块回归本分:读派生态 → 催/重判。
 *  - 再分析只写派生表,零 SoR,可直接点。失败弹 toast 不静默。
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Ico, ICON, invalidateAIState, type DerivedIssueState, type TInboxTriage } from "./ai-state-line";

// ── BARSOUL Inbox Phase3: 个人收件箱分流(完成/归档/Snooze/Pin/Mute/回队)──
// 只写 per-user inbox_states 派生投影,**绝不碰 SoR**。审批/托管中卡的隐藏动作被服务层
// 冻结(409)→ 这里转成温和 toast,不静默失败。返回最新分流态供乐观更新回执。
export type TriageAction = "read" | "done" | "archive" | "snooze" | "pin" | "mute" | "reset";
export async function triageInbox(
  slug: string,
  projectId: string,
  issueId: string,
  action: TriageAction,
  zh: boolean,
  opts?: { snoozedTill?: string; value?: boolean }
): Promise<TInboxTriage | null> {
  if (!slug || !projectId || !issueId) return null;
  try {
    const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/inbox/triage/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, snoozed_till: opts?.snoozedTill, value: opts?.value }),
    });
    if (r.status === 409) {
      // 托管=审批闸门:审批未完成不可清出(feedback_approval_state_lock)
      setToast({
        type: TOAST_TYPE.INFO,
        title: zh ? "审批中,暂不能清出" : "承認中のため片付けできません",
        message: zh ? "需先完成审批,卡片才会离开收件箱" : "承認を完了すると受信箱から外れます",
      });
      return null;
    }
    if (!r.ok) throw new Error();
    return (await r.json()) as TInboxTriage;
  } catch {
    setToast({
      type: TOAST_TYPE.ERROR,
      title: zh ? "操作失败" : "操作に失敗しました",
      message: zh ? "请稍后重试" : "後ほど再度お試しください",
    });
    return null;
  }
}

function useZhLite(): boolean {
  const { currentLocale } = useTranslation();
  return (currentLocale || "").toLowerCase().startsWith("zh");
}

// ── 全局单一对话框 store(浮层会随 hover 卸载,对话框挂更外层、由 store 驱动)──
export type DISDialog = { issueId: string; projectId: string; actorName: string; nextAction: string } | null;
let _dlg: DISDialog = null;
const _dlgSubs = new Set<() => void>();
export const disDialog = {
  open(d: DISDialog) {
    _dlg = d;
    _dlgSubs.forEach((f) => f());
  },
  close() {
    _dlg = null;
    _dlgSubs.forEach((f) => f());
  },
  get() {
    return _dlg;
  },
};
function useDISDialog(): DISDialog {
  return useSyncExternalStore(
    (cb) => {
      _dlgSubs.add(cb);
      return () => _dlgSubs.delete(cb);
    },
    () => _dlg,
    () => null
  );
}

// 重判落地后两档延时刷新该卡(覆盖 worker 去抖 4s + LLM ~30s)
function scheduleRefresh(issueId: string) {
  setTimeout(() => {
    try {
      invalidateAIState(issueId);
    } catch {
      /* noop */
    }
  }, 6000);
  setTimeout(() => {
    try {
      invalidateAIState(issueId);
    } catch {
      /* noop */
    }
  }, 18000);
}

// ── 再分析:仅重算派生表,零 SoR。可直接点(无需确认)。──
export async function rederiveAIState(slug: string, projectId: string, issueId: string, zh: boolean) {
  if (!slug || !projectId || !issueId) return;
  try {
    const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/ai-state/rederive/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok && r.status !== 202) throw new Error();
    setToast({
      type: TOAST_TYPE.INFO,
      title: zh ? "已触发重新分析" : "再分析を開始しました",
      message: zh ? "AI 正在重新判断,稍后自动刷新" : "AI が再判定中。まもなく自動更新されます",
    });
    scheduleRefresh(issueId);
  } catch {
    setToast({
      type: TOAST_TYPE.ERROR,
      title: zh ? "触发失败" : "失敗しました",
      message: zh ? "请稍后重试" : "後ほど再度お試しください",
    });
  }
}

// 催促默认文案(愛ちゃん 口吻;@提及由服务端加,故正文不重复人名)。
function defaultUrgeText(nextAction: string, zh: boolean) {
  if (zh) return `麻烦跟进一下这张卡。${nextAction ? `下一步:${nextAction}。` : ""}方便的话同步下进展,谢谢!`;
  return `本件のフォローをお願いします。${nextAction ? `次のアクション:${nextAction}。` : ""}進捗を共有いただけると助かります。`;
}

// ── 共享的「行动操作条」:催促(愛ちゃん 名义) / 再分析 ── 浮层、详情内嵌、作业台行 复用。
export function DISActionBar({
  s,
  projectId,
  zh,
  compact,
}: {
  s: DerivedIssueState;
  projectId: string;
  zh: boolean;
  compact?: boolean;
}) {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const nextAction = (zh ? s.next_action?.zh : s.next_action?.ja) || s.next_action?.zh || s.next_action?.ja || "";
  const actorName = s.actor_name || "";
  const [busy, setBusy] = useState(false);
  const Btn = ({
    icon,
    label,
    onClick,
    tone,
  }: {
    icon: string[];
    label: string;
    onClick: () => void;
    tone?: string;
  }) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={busy}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 26,
        padding: compact ? "0 8px" : "0 10px",
        border: "1px solid #e3e5e9",
        borderRadius: 6,
        background: "#fff",
        color: tone || "#33363c",
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: busy ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Ico d={icon} size={12} color={tone || "#7c5cff"} />
      {label}
    </button>
  );
  return (
    <div
      style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
      role="presentation"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Btn
        icon={ICON.bell}
        label={zh ? "催促" : "催促する"}
        onClick={() => disDialog.open({ issueId: s.issue_id, projectId, actorName, nextAction })}
      />
      <Btn
        icon={ICON.refresh}
        label={zh ? "再分析" : "再分析"}
        tone="#6b7280"
        onClick={async () => {
          setBusy(true);
          await rederiveAIState(slug, projectId, s.issue_id, zh);
          setBusy(false);
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 全局催促对话框(挂一份在 layout root)。确认/可编辑后,以 愛ちゃん 名义发评论 + @当前行动人。
// ════════════════════════════════════════════════════════════════════════════
const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgba(16,24,40,0.32)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
const panel: CSSProperties = {
  width: 460,
  maxWidth: "100%",
  maxHeight: "82vh",
  overflow: "auto",
  background: "#fff",
  borderRadius: 12,
  boxShadow: "0 24px 64px -12px rgba(16,24,40,0.4)",
  display: "flex",
  flexDirection: "column",
};

export const GlobalDISActionDialogs = observer(function GlobalDISActionDialogs() {
  const d = useDISDialog();
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const zh = useZhLite();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // 打开即让 愛ちゃん(本地 gemma)结合这张卡的具体情况起草一条友好·有理有据的催促(非模板)。
  useEffect(() => {
    if (!d) return;
    let cancelled = false;
    setText("");
    setLoading(true);
    (async () => {
      let draft = "";
      try {
        const r = await fetch(`/api/workspaces/${slug}/projects/${d.projectId}/issues/${d.issueId}/ai-state/urge/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: true }),
        });
        if (r.ok) draft = (((await r.json()) || {}).text || "").trim();
      } catch {
        /* noop */
      }
      if (cancelled) return;
      setText(draft || defaultUrgeText(d.nextAction, zh)); // 生成失败兜底:简洁默认
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [d?.issueId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null;
  const close = () => {
    if (!busy) disDialog.close();
  };
  const who = d.actorName || (zh ? "当前行动人" : "現在の担当");

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workspaces/${slug}/projects/${d.projectId}/issues/${d.issueId}/ai-state/urge/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });
      if (!r.ok) throw new Error();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: zh ? "愛ちゃん 已发出催促" : "愛ちゃんが催促しました",
        message: zh ? "已以 愛ちゃん 名义 @ 对方并通知" : "愛ちゃん名義で相手にメンション・通知しました",
      });
      rederiveAIState(slug, d.projectId, d.issueId, zh);
      disDialog.close();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: zh ? "发送失败" : "送信に失敗しました",
        message: zh ? "请稍后重试" : "後ほど再度お試しください",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={overlay}
      role="presentation"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div
        style={panel}
        role="presentation"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "13px 16px",
            borderBottom: "1px solid #f0f1f3",
          }}
        >
          <Ico d={ICON.bell} size={15} color="#7c5cff" sw={1.8} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#2b2e33", flex: 1 }}>
            {zh ? "让 愛ちゃん 催促" : "愛ちゃんにリマインドさせる"}
          </span>
          <button
            type="button"
            onClick={close}
            title={zh ? "关闭" : "閉じる"}
            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0 }}
          >
            <Ico d={ICON.close} size={16} color="#9ca3af" />
          </button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.6 }}>
            {zh ? (
              <>
                将以 <b style={{ color: "#7c5cff" }}>愛ちゃん</b> 的名义发布评论,并 @ <b>{who}</b>{" "}
                通知对方(对方语言自动翻译)。可编辑后发送。
              </>
            ) : (
              <>
                「<b style={{ color: "#7c5cff" }}>愛ちゃん</b>」名義でコメントを投稿し、<b>{who}</b>{" "}
                をメンションして通知します(相手の言語へ自動翻訳)。編集して送信できます。
              </>
            )}
          </div>
          {loading && (
            <div style={{ fontSize: 11.5, color: "#7c5cff", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Ico d={ICON.sparkle} size={12} color="#7c5cff" />
              {zh ? "愛ちゃん 正在结合卡片情况斟酌措辞…" : "愛ちゃんがカードの状況をふまえて文面を考えています…"}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={loading}
            placeholder={loading ? (zh ? "稍候…" : "少々お待ちください…") : ""}
            style={{
              width: "100%",
              resize: "vertical",
              border: "1px solid #d8dadf",
              borderRadius: 8,
              padding: "9px 11px",
              fontSize: 13,
              lineHeight: 1.55,
              fontFamily: "inherit",
              color: "#1f2328",
              boxSizing: "border-box",
              background: loading ? "#fafafa" : "#fff",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              style={{
                height: 32,
                padding: "0 14px",
                border: "1px solid #e3e5e9",
                borderRadius: 7,
                background: "#fff",
                color: "#444",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {zh ? "取消" : "キャンセル"}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={busy || loading || !text.trim()}
              style={{
                height: 32,
                padding: "0 16px",
                border: "none",
                borderRadius: 7,
                background: busy || loading || !text.trim() ? "#b9a9ff" : "#7c5cff",
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: busy || loading || !text.trim() ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Ico d={ICON.send} size={13} color="#fff" />
              {busy ? (zh ? "发送中…" : "送信中…") : zh ? "以 愛ちゃん 发送" : "愛ちゃんで送信"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
