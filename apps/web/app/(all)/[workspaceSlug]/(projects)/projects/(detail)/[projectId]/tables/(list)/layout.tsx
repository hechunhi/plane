// BARSOUL: 智能表 / 项目数据库 feature 列表布局(项目侧栏 feature, 和 工作项/页面 同级).
import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { TablesListHeader } from "./header";

export default function ProjectTablesListLayout() {
  return (
    <>
      <AppHeader header={<TablesListHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
