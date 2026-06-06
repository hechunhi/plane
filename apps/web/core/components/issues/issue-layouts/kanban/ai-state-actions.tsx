/**
 * BARSOUL DIS v9: 卡片当前态「行动操作」(人手发起,经用户自己的会话写 SoR)。
 *
 * 宪法合规要点:
 *  - 这些不是「愛ちゃん 自主写 SoR」,而是**管理者本人**点按钮、走**自己的 cookie 会话**
 *    做他在 Plane 本来就能做的操作(发评论 / 改担当)。等同于在原生 UI 操作,只是更快。
 *  - 凡写 SoR 的(催促=发评论、再指派=改 assignee)一律**确认闸门**(预览/可编辑/二次确认),
 *    满足「发送消息/改状态前显式批准」。再分析只写**派生表**,零 SoR,可直接点。
 *  - 失败安全:任何失败弹 toast,不静默;不触碰 SoR 的真值口径。
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useMember } from "@/hooks/store/use-member";
import { Ico, ICON, AvatarBadge, invalidateAIState, type DerivedIssueState } from "./ai-state-line";

function useZhLite(): boolean {
  const { currentLocale } = useTranslation();
  return (currentLocale || "").toLowerCase().startsWith("zh");
}

// ── 全局单一对话框 store(镜像 aiPopover 的模块单例模式;浮层会随 hover 卸载,
//    对话框必须挂在更外层、由 store 驱动,才能在浮层消失后继续存在)──
// 两种对话框形状一致 → 单一类型 + kind 判别(避免判别联合的窄化赋值坑)。
export type DISDialog = { kind: "urge" | "reassign"; issueId: string; projectId: string; actorName: string; nextAction: string } | null;
let _dlg: DISDialog = null;
const _dlgSubs = new Set<() => void>();
export const disDialog = {
  open(d: DISDialog) { _dlg = d; _dlgSubs.forEach((f) => f()); },
  close() { _dlg = null; _dlgSubs.forEach((f) => f()); },
  get() { return _dlg; },
};
function useDISDialog(): DISDialog {
  return useSyncExternalStore((cb) => { _dlgSubs.add(cb); return () => _dlgSubs.delete(cb); }, () => _dlg, () => null);
}

// 重判落地后两档延时刷新该卡(覆盖 worker 去抖 4s + LLM ~30s)
function scheduleRefresh(issueId: string) {
  setTimeout(() => { try { invalidateAIState(issueId); } catch { /* noop */ } }, 6000);
  setTimeout(() => { try { invalidateAIState(issueId); } catch { /* noop */ } }, 18000);
}

// ── 再分析:仅重算派生表,零 SoR。可直接点(无需确认)。──
export async function rederiveAIState(slug: string, projectId: string, issueId: string, zh: boolean) {
  if (!slug || !projectId || !issueId) return;
  try {
    const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/ai-state/rederive/`,
      { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok && r.status !== 202) throw new Error();
    setToast({ type: TOAST_TYPE.INFO, title: zh ? "已触发重新分析" : "再分析を開始しました",
      message: zh ? "AI 正在重新判断,稍后自动刷新" : "AI が再判定中。まもなく自動更新されます" });
    scheduleRefresh(issueId);
  } catch {
    setToast({ type: TOAST_TYPE.ERROR, title: zh ? "触发失败" : "失敗しました", message: zh ? "请稍后重试" : "後ほど再度お試しください" });
  }
}

function defaultUrgeText(actorName: string, nextAction: string, zh: boolean) {
  const who = actorName || (zh ? "担当の方" : "ご担当者");
  if (zh) return `${who},这张卡需要你跟进一下。${nextAction ? `下一步:${nextAction}。` : ""}方便的话同步下进展,谢谢!`;
  return `${who}さん、本件のご対応をお願いできますでしょうか。${nextAction ? `次のアクション:${nextAction}。` : ""}進捗を共有いただけると助かります。`;
}

// ── 共享的「行动操作条」:再分析 / 催促 / 再指派 ── 浮层、详情内嵌、作业台行 复用。
export function DISActionBar({ s, projectId, zh, compact }: { s: DerivedIssueState; projectId: string; zh: boolean; compact?: boolean }) {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const nextAction = (zh ? s.next_action?.zh : s.next_action?.ja) || s.next_action?.zh || s.next_action?.ja || "";
  const actorName = s.actor_name || "";
  const [busy, setBusy] = useState(false);
  const open = (kind: "urge" | "reassign") => disDialog.open({ kind, issueId: s.issue_id, projectId, actorName, nextAction });
  const Btn = ({ icon, label, onClick, tone }: { icon: string[]; label: string; onClick: () => void; tone?: string }) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={busy} title={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: compact ? "0 8px" : "0 10px",
        border: "1px solid #e3e5e9", borderRadius: 6, background: "#fff", color: tone || "#33363c",
        fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" }}>
      <Ico d={icon} size={12} color={tone || "#7c5cff"} />{label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
      <Btn icon={ICON.bell} label={zh ? "催促" : "催促する"} onClick={() => open("urge")} />
      <Btn icon={ICON.users} label={zh ? "改担当" : "担当者を変更"} onClick={() => open("reassign")} />
      <Btn icon={ICON.refresh} label={zh ? "再分析" : "再分析"} tone="#6b7280"
        onClick={async () => { setBusy(true); await rederiveAIState(slug, projectId, s.issue_id, zh); setBusy(false); }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 全局对话框(挂一份在 layout root)。urge=确认发评论;reassign=选成员后确认改担当。
// ════════════════════════════════════════════════════════════════════════════
const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 200, background: "rgba(16,24,40,0.32)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const panel: CSSProperties = { width: 460, maxWidth: "100%", maxHeight: "82vh", overflow: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 24px 64px -12px rgba(16,24,40,0.4)", display: "flex", flexDirection: "column" };

export const GlobalDISActionDialogs = observer(function GlobalDISActionDialogs() {
  const d = useDISDialog();
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const zh = useZhLite();
  const { getUserDetails, project: { getProjectMemberIds } } = useMember();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 每次开新对话框,重置编辑态
  useEffect(() => {
    if (d?.kind === "urge") setText(defaultUrgeText(d.actorName, d.nextAction, zh));
    setPicked(null);
  }, [d?.kind, d?.issueId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null;
  const close = () => { if (!busy) disDialog.close(); };

  const Header = ({ icon, title }: { icon: string[]; title: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", borderBottom: "1px solid #f0f1f3" }}>
      <Ico d={icon} size={15} color="#7c5cff" sw={1.8} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: "#2b2e33", flex: 1 }}>{title}</span>
      <button type="button" onClick={close} title={zh ? "关闭" : "閉じる"}
        style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0 }}>
        <Ico d={ICON.close} size={16} color="#9ca3af" />
      </button>
    </div>
  );

  // ── 催促:确认/可编辑后,以「本人评论」发出(评论区会自动多语言化给对方)──
  if (d.kind === "urge") {
    const send = async () => {
      const html = `<p>${text.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`;
      if (!text.trim()) return;
      setBusy(true);
      try {
        const r = await fetch(`/api/workspaces/${slug}/projects/${d.projectId}/issues/${d.issueId}/comments/`,
          { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment_html: html }) });
        if (!r.ok) throw new Error();
        setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "催促已发送" : "催促を送信しました", message: zh ? "评论已发布,对方会收到通知" : "コメントを投稿しました。相手に通知されます" });
        rederiveAIState(slug, d.projectId, d.issueId, zh);
        disDialog.close();
      } catch {
        setToast({ type: TOAST_TYPE.ERROR, title: zh ? "发送失败" : "送信に失敗しました", message: zh ? "请稍后重试" : "後ほど再度お試しください" });
      } finally { setBusy(false); }
    };
    return (
      <div style={overlay} onClick={close}>
        <div style={panel} onClick={(e) => e.stopPropagation()}>
          <Header icon={ICON.bell} title={zh ? "催促对方处理" : "対応を催促する"} />
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11.5, color: "#6b7280" }}>
              {zh ? "将以你本人的身份发布一条评论(对方语言会自动翻译)。可在下方编辑后发送。"
                  : "あなた本人のコメントとして投稿します(相手の言語へ自動翻訳)。下記を編集のうえ送信できます。"}
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus
              style={{ width: "100%", resize: "vertical", border: "1px solid #d8dadf", borderRadius: 8, padding: "9px 11px", fontSize: 13, lineHeight: 1.55, fontFamily: "inherit", color: "#1f2328", boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} disabled={busy}
                style={{ height: 32, padding: "0 14px", border: "1px solid #e3e5e9", borderRadius: 7, background: "#fff", color: "#444", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{zh ? "取消" : "キャンセル"}</button>
              <button type="button" onClick={send} disabled={busy || !text.trim()}
                style={{ height: 32, padding: "0 16px", border: "none", borderRadius: 7, background: busy || !text.trim() ? "#b9a9ff" : "#7c5cff", color: "#fff", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: busy || !text.trim() ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Ico d={ICON.send} size={13} color="#fff" />{busy ? (zh ? "发送中…" : "送信中…") : (zh ? "发送" : "送信")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 再指派:列出项目成员,选一个不同的人 → 二次确认改 assignee(本人会话)──
  const memberIds = (getProjectMemberIds(d.projectId, false) ?? []).filter(Boolean);
  const reassign = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workspaces/${slug}/projects/${d.projectId}/issues/${d.issueId}/`,
        { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignee_ids: [picked] }) });
      if (!r.ok) throw new Error();
      const u = getUserDetails(picked);
      setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "担当已变更" : "担当者を変更しました", message: (u?.display_name || "") + (zh ? " 已被指派为担当" : " さんを担当に設定しました") });
      rederiveAIState(slug, d.projectId, d.issueId, zh);
      disDialog.close();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "变更失败" : "変更に失敗しました", message: zh ? "请稍后重试" : "後ほど再度お試しください" });
    } finally { setBusy(false); }
  };
  return (
    <div style={overlay} onClick={close}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <Header icon={ICON.users} title={zh ? "变更担当者" : "担当者を変更"} />
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, color: "#6b7280" }}>
            {zh ? `当前:${d.actorName || "未指派"}。选择新的担当者,确认后变更。` : `現在:${d.actorName || "未割当"}。新しい担当者を選び、確認のうえ変更します。`}
          </div>
          <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid #eceef1", borderRadius: 8 }}>
            {memberIds.length === 0 && <div style={{ padding: 14, fontSize: 12, color: "#9ca3af" }}>{zh ? "无可选成员" : "メンバーがいません"}</div>}
            {memberIds.map((id) => {
              const u = getUserDetails(id);
              if (!u) return null;
              const sel = picked === id;
              return (
                <button key={id} type="button" onClick={() => setPicked(id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", border: "none", borderBottom: "1px solid #f3f4f6",
                    background: sel ? "#f3f0ff" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                  <AvatarBadge name={u.display_name || "?"} size={22} />
                  <span style={{ fontSize: 13, color: "#1f2328", fontWeight: sel ? 700 : 500, flex: 1 }}>{u.display_name}</span>
                  {sel && <Ico d={["M20 6L9 17l-5-5"]} size={15} color="#7c5cff" sw={2.4} />}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={close} disabled={busy}
              style={{ height: 32, padding: "0 14px", border: "1px solid #e3e5e9", borderRadius: 7, background: "#fff", color: "#444", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{zh ? "取消" : "キャンセル"}</button>
            <button type="button" onClick={reassign} disabled={busy || !picked}
              style={{ height: 32, padding: "0 16px", border: "none", borderRadius: 7, background: busy || !picked ? "#b9a9ff" : "#7c5cff", color: "#fff", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: busy || !picked ? "default" : "pointer" }}>
              {busy ? (zh ? "变更中…" : "変更中…") : (zh ? "确认变更" : "変更を確定")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
