// BARSOUL: 智能表 / 项目数据库 feature 页. SmartTablesRoot 内部读 useParams 拿 ws/pid.
import { observer } from "mobx-react";
import { SmartTablesRoot } from "@/components/smart-table/smart-tables-root";

function ProjectTablesPage() {
  return <SmartTablesRoot />;
}

export default observer(ProjectTablesPage);
