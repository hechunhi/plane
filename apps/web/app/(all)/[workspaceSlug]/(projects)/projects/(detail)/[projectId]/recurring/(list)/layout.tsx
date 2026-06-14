// BARSOUL: 定期タスク / 周期任务 feature 布局(项目侧栏 feature, 与数据表平级). 见 docs/architecture/recurring-tasks-mvp.md.
import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { RecurringListHeader } from "./header";

export default function ProjectRecurringListLayout() {
  return (
    <>
      <AppHeader header={<RecurringListHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
