/**
 * BARSOUL DIS v4/v7: 工作项详情/peek 内嵌「AI 当前态」常驻区块。
 * v7: 人进详情可向 AI 补足背景/纠正(自动多语言 + 留痕),提交后 AI 据此重判。
 */
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssueAIState, useZh, pick, invalidateAIState, Ico, ICON } from "./ai-state-line";
import { AICurrentStateBody } from "./ai-current-state-popover";
import { DISActionBar } from "./ai-state-actions";

const LOW_CONF = 0.45;

export const AICurrentStateInline = observer(function AICurrentStateInline({ issueId, projectId }: { issueId: string; projectId: string }) {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const zh = useZh();
  const issueDetail = useIssueDetail();
  const s = useIssueAIState(slug, projectId, issueId);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // 留痕缺口:AI 判不出状态变更原因 → 自动展开补充表单(强提醒,可手动关闭)
  useEffect(() => {
    if (s?.needs_info && !(s?.human_note?.zh || s?.human_note?.ja) && !done) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.needs_info]);

  if (!s) return null;

  const wrap = "mt-2 rounded-lg border p-2.5";
  const wrapStyle = { borderColor: "#ece9fb", background: "#fbfaff" } as const;
  const note = pick(s.human_note, zh);

  const submit = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/ai-state/correct/`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ note: v }),
      });
      if (r.ok) {
        setText(""); setOpen(false); setDone(true);
        // AI 重判走 cloud Claude(~30s)。多档延时刷新覆盖重判落地窗口,
        // 否则「要補足」在 DB 清了但前端(尤其作业台)还挂着旧态(BS-24 现象)。
        [3000, 18000, 40000].forEach((ms) => setTimeout(() => { try { invalidateAIState(issueId); } catch { /* noop */ } }, ms));
      }
    } catch {
      /* noop */
    }
    setBusy(false);
  };

  // 补足/纠正 表单(无论是否已有派生态都允许)
  const correctUI = (
    <div style={{ marginTop: 9 }}>
      {note && (
        <div style={{ fontSize: 11, color: "#5d5f64", background: "#f2effb", border: "1px solid #e4def6", borderRadius: 6, padding: "6px 8px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#7c5cff", fontWeight: 600, marginBottom: 2 }}>
            <Ico d={["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"]} size={11} color="#7c5cff" />
            {zh ? "人工补充" : "担当者の補足"}{s.corrected_by ? ` · ${s.corrected_by}` : ""}
          </div>
          {note}
        </div>
      )}
      {done && (
        <div style={{ fontSize: 11, color: "#3a7", marginBottom: 8 }}>{zh ? "已提交,AI 正在重新分析…" : "送信しました。AI が再分析中…"}</div>
      )}
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* v12 补充框架:needs_info 时,AI 结合本卡给出「该写什么」的引导(按阅览者语言) */}
          {s.needs_info && pick(s.info_framework, zh) && (
            <div style={{ fontSize: 11.5, color: "#5b5340", background: "#fdf8ec", border: "1px solid #f0e3c2", borderRadius: 6, padding: "8px 10px", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#b07d12", fontWeight: 700, marginBottom: 4 }}>
                <Ico d={ICON.sparkle} size={12} color="#d99a1e" />{zh ? "补充指引" : "補足ガイド"}
              </div>
              {pick(s.info_framework, zh)}
            </div>
          )}
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
            placeholder={zh ? "补充评论里没有、AI 看不到的背景,或纠正判断(例:已在电话里口头确认,无需催办)。自动多语言、留痕。" : "コメントに出ていない・AIが把握できない背景の補足、または判断の訂正(例:電話で口頭確認済み、催促不要)。自動翻訳・履歴保存。"}
            style={{ width: "100%", fontSize: 12, color: "#1f2328", border: "1px solid #d6d3ea", borderRadius: 6, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={submit} disabled={busy || !text.trim()}
              style={{ height: 26, padding: "0 12px", border: "none", borderRadius: 6, background: busy || !text.trim() ? "#c3b9ee" : "#7c5cff", color: "#fff", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: busy || !text.trim() ? "default" : "pointer" }}>
              {busy ? (zh ? "提交中…" : "送信中…") : (zh ? "提交并重判" : "送信して再判断")}
            </button>
            <button type="button" onClick={() => { setOpen(false); setText(""); }}
              style={{ height: 26, padding: "0 10px", border: "1px solid #e3e5e9", borderRadius: 6, background: "#fff", color: "#71757c", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {zh ? "取消" : "キャンセル"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setOpen(true); setDone(false); }}
          style={{ height: 26, padding: "0 10px", border: "1px solid #e3e5e9", borderRadius: 6, background: "#fff", color: "#7c5cff", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Ico d={["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"]} size={12} color="#7c5cff" />{note ? (zh ? "修改补充" : "補足を編集") : (zh ? "向 AI 补充 / 纠正" : "AI に補足・訂正")}
        </button>
      )}
    </div>
  );

  // 空状态兜底:仍展示补足入口(让人能给信息不足的卡补背景)
  if (s.state === "UNKNOWN" || !s.ball) {
    return (
      <div className={wrap} style={wrapStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#9499a0" }}>
          <Ico d={ICON.sparkle} size={13} color="#b8aef0" sw={1.8} />
          {zh ? "AI 当前态:信息不足,建议补充背景" : "AI 現状:情報不足、背景の補足を推奨"}
        </div>
        {correctUI}
      </div>
    );
  }

  const conf = s.confidence >= 0.75 ? { t: zh ? "高" : "高", c: "#16a34a" } : s.confidence >= LOW_CONF ? { t: zh ? "中" : "中", c: "#b45309" } : { t: zh ? "低" : "低", c: "#c0392b" };
  const jumpComment = () => {
    try {
      const ids = issueDetail.comment?.getCommentsByIssueId?.(issueId);
      const last = ids && ids.length ? ids[ids.length - 1] : undefined;
      if (last) issueDetail.setScrollToActivityCommentId(last);
    } catch {
      /* noop */
    }
  };

  return (
    <div className={wrap} style={wrapStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Ico d={ICON.sparkle} size={13} color="#7c5cff" sw={1.8} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3a3d42", letterSpacing: ".02em" }}>{zh ? "AI 当前态" : "AI 現状"}</span>
        {s.confidence < LOW_CONF ? (
          <span title={(zh ? "AI 置信度:低" : "AI 確度:低")} style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: "#92700a", background: "#fdf6dd", border: "1px solid #ecd98a", borderRadius: 4, padding: "0 5px" }}>{zh ? "AI 不确定" : "AI 不確実"}</span>
        ) : (
          <span title={(zh ? "AI 置信度:" : "AI 確度:") + conf.t} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: conf.c }}>{(zh ? "置信度 " : "確度 ") + conf.t}</span>
        )}
      </div>
      <AICurrentStateBody s={s} zh={zh} projectId={projectId} onSource={jumpComment} />
      <div style={{ marginTop: 9, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={jumpComment} style={{ height: 26, padding: "0 10px", border: "1px solid #e3e5e9", borderRadius: 6, background: "#fff", color: "#33363c", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Ico d={ICON.message} size={12} color="#7c5cff" />{zh ? "跳到最新评论" : "最新コメントへ移動"}
        </button>
        {/* v9 行动操作:催促/改担当(确认闸门)/再分析 */}
        <DISActionBar s={s} projectId={projectId} zh={zh} />
      </div>
      {correctUI}
    </div>
  );
});
