// BARSOUL: 定期タスク feature 头部(面包屑). 照 TablesListHeader.
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Repeat } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { useProject } from "@/hooks/store/use-project";
import { CommonProjectBreadcrumbs } from "@/plane-web/components/breadcrumbs/common";

export const RecurringListHeader = observer(function RecurringListHeader() {
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  const { currentProjectDetails, loader } = useProject();
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs isLoading={loader === "init-loader"}>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("sidebar.recurring")}
                href={`/${workspaceSlug}/projects/${currentProjectDetails?.id}/recurring/`}
                icon={<Repeat className="h-4 w-4 text-tertiary" />}
                isLast
              />
            }
            isLast
          />
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
