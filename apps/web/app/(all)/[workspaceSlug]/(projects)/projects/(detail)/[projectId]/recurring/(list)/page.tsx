// BARSOUL: 定期タスク feature 页. RecurringRoot 内部读 useParams 拿 ws/pid.
import { observer } from "mobx-react";
import { RecurringRoot } from "@/components/recurring/recurring-root";

function ProjectRecurringPage() {
  return <RecurringRoot />;
}

export default observer(ProjectRecurringPage);
