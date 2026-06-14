/**
 * BARSOUL B-3e(2026-06-11 用户拍板「不要评论留痕, 用 activity 流水」):
 * 流程干预审计行 — 原生 activity 形态(一行灰字, 零通知零评论)。
 * 文案整句在 activity.comment(后端干预端点生成, zh; 含动词/站名/理由)。
 */
import { observer } from "mobx-react";
import { Wrench } from "lucide-react";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";

type TProps = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueFlowInterveneActivity = observer(function IssueFlowInterveneActivity(props: TProps) {
  const { activityId, ends } = props;
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<Wrench className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>{activity.comment}.</>
    </IssueActivityBlockComponent>
  );
});
