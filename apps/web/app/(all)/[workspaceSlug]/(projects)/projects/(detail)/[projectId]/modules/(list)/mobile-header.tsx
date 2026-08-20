/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { MODULE_VIEW_LAYOUTS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { ChevronDownIcon } from "@plane/propel/icons";
import { CustomMenu, Row } from "@plane/ui";
import { ModuleLayoutIcon } from "@/components/modules";
import { useModuleFilter } from "@/hooks/store/use-module-filter";
import { useProject } from "@/hooks/store/use-project";
import { MOBILE_HEADER_INLINE_CLASS, MOBILE_HEADER_ITEM_CLASS } from "@/components/core/app-header";

export const ModulesListMobileHeader = observer(function ModulesListMobileHeader() {
  const { currentProjectDetails } = useProject();
  const { updateDisplayFilters } = useModuleFilter();
  const { t } = useTranslation();

  return (
    <div className={MOBILE_HEADER_INLINE_CLASS}>
      <CustomMenu
        maxHeight={"md"}
        className={MOBILE_HEADER_ITEM_CLASS}
        // placement="bottom-start"
        customButton={
          <Row className="flex items-center gap-1 text-13 text-secondary">
            <span>Layout</span> <ChevronDownIcon className="my-auto h-4 w-4 text-secondary" strokeWidth={1} />
          </Row>
        }
        customButtonClassName="flex items-center text-secondary text-13"
        closeOnSelect
      >
        {MODULE_VIEW_LAYOUTS.map((layout) => {
          if (layout.key == "gantt") return;
          return (
            <CustomMenu.MenuItem
              key={layout.key}
              onClick={() => {
                updateDisplayFilters(currentProjectDetails!.id.toString(), { layout: layout.key });
              }}
              className="flex items-center gap-2"
            >
              <ModuleLayoutIcon layoutType={layout.key} />
              <div className="text-tertiary">{t(layout.i18n_title)}</div>
            </CustomMenu.MenuItem>
          );
        })}
      </CustomMenu>
    </div>
  );
});
