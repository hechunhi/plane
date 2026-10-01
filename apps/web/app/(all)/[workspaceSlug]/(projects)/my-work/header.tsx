/**
 * BARSOUL BS-216 Path A: 工作区级「我的工作」(Personal Work Hub)ヘッダ。
 * Inbox を「動的タイムライン」から「毎日開く個人作業入口」へ——その入口ページの
 * ヘッダ。中身は MyWorkRoot(通知センター流用 + レンズ)。
 */
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { InboxIcon } from "@plane/propel/icons";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";

export const MyWorkHeader = observer(function MyWorkHeader() {
  const { t } = useTranslation();
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink label={t("sidebar.my_work")} icon={<InboxIcon className="h-4 w-4 text-tertiary" />} />
            }
          />
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
