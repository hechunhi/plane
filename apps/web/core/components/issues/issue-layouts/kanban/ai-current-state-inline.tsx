/**
 * BARSOUL DIS v4 (item 2): 工作项详情/peek 面板内嵌的「AI 当前态」常驻区块。
 * 详情打开时用这个代替 hover 浮层(浮层只服务看板未打开态)。字段与浮层一致。
 * item 6: 操作按钮 = 「最新コメントへ移動」(定位推断所依据的最新评论)。
 */
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssueAIState, useZh, Ico, ICON } from "./ai-state-line";
import { AICurrentStateBody } from "./ai-current-state-popover";

const LOW_CONF = 0.45;

export const AICurrentStateInline = observer(function AICurrentStateInline({ issueId, projectId }: { issueId: string; projectId: string }) {
  const { workspaceSlug } = useParams();
  const zh = useZh();
  const issueDetail = useIssueDetail();
  const s = useIssueAIState(workspaceSlug?.toString(), projectId, issueId);
  if (!s) return null;

  const wrap = "mt-2 rounded-lg border p-2.5";
  const wrapStyle = { borderColor: "#ece9fb", background: "#fbfaff" } as const;

  // 空状态兜底
  if (s.state === "UNKNOWN" || !s.ball) {
    return (
      <div className={wrap} style={wrapStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#9499a0" }}>
          <Ico d={ICON.sparkle} size={13} color="#b8aef0" sw={1.8} />
          {zh ? "AI 当前态:信息不足,建议补充评论" : "AI 現状:情報不足、コメント追記を推奨"}
        </div>
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
      <AICurrentStateBody s={s} zh={zh} onSource={jumpComment} />
      <div style={{ marginTop: 9 }}>
        <button type="button" onClick={jumpComment} style={{ height: 26, padding: "0 10px", border: "1px solid #e3e5e9", borderRadius: 6, background: "#fff", color: "#33363c", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Ico d={ICON.message} size={12} color="#7c5cff" />{zh ? "跳到最新评论" : "最新コメントへ移動"}
        </button>
      </div>
    </div>
  );
});
