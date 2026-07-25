/**
 * BARSOUL 週次ミーティング — ヘッダ (hechun 2026-07-24)
 * 会期の切替と操作は画面内のツールバーに置く(ヘッダは所在表示に徹する)。
 */
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
import { CalendarDays } from "lucide-react";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";

export const WeeklyHeader = observer(function WeeklyHeader() {
  const { t } = useTranslation();
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("sidebar.weekly")}
                icon={<CalendarDays className="h-4 w-4 text-tertiary" />}
              />
            }
          />
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
