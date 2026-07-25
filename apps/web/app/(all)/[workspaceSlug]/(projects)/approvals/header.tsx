/**
 * BARSOUL 2026-07-25 審査を一等市民に·受信箱: ヘッダ。ワークスペース級「審査」
 * ビューの入口。my-work と同じ Breadcrumb 一枚構成。
 */
import { observer } from "mobx-react";
import { Stamp } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";

export const ApprovalsHeader = observer(function ApprovalsHeader() {
  const { t } = useTranslation();
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink label={t("sidebar.approvals")} icon={<Stamp className="h-4 w-4 text-tertiary" />} />
            }
          />
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
