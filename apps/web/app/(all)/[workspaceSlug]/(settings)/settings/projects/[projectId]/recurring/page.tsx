/**
 * BARSOUL: 定期タスク 项目设置页 — 设置面板可达(用户「设置里找不到」)。
 * 复用 RecurringRoot(内部读 useParams 拿 ws/pid), 与侧栏 /recurring 同一组件一概念。
 */
import { observer } from "mobx-react";
import { Repeat } from "lucide-react";
// plane imports
import { PROJECT_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { RecurringRoot } from "@/components/recurring/recurring-root";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsPageHeader } from "@/components/settings/page-header";

function RecurringSettingsPage() {
  const { t } = useTranslation();
  const label = t(PROJECT_SETTINGS.recurring.i18n_label);
  return (
    <SettingsContentWrapper
      header={
        <SettingsPageHeader
          leftItem={
            <Breadcrumbs>
              <Breadcrumbs.Item
                component={<BreadcrumbLink label={label} icon={<Repeat className="size-4 text-tertiary" />} />}
              />
            </Breadcrumbs>
          }
        />
      }
    >
      <RecurringRoot />
    </SettingsContentWrapper>
  );
}

export default observer(RecurringSettingsPage);
