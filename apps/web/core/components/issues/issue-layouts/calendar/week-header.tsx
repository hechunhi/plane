/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Locale } from "date-fns";
import { format } from "date-fns";
import { ja, zhCN, zhTW } from "date-fns/locale";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { EStartOfTheWeek } from "@plane/types";
import { getOrderedDays } from "@plane/utils";
import { DAYS_LIST } from "@/constants/calendar";
// helpers
// hooks
import { useUserProfile } from "@/hooks/store/user";

const DATE_FNS_LOCALE_MAP: Record<string, Locale | undefined> = {
  ja,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

type Props = {
  isLoading: boolean;
  showWeekends: boolean;
};

export const CalendarWeekHeader = observer(function CalendarWeekHeader(props: Props) {
  const { isLoading, showWeekends } = props;
  // hooks
  const { currentLocale } = useTranslation();
  const { data } = useUserProfile();
  const startOfWeek = data?.start_of_the_week;

  // derived
  const dateFnsLocale = DATE_FNS_LOCALE_MAP[currentLocale];
  const orderedDays = getOrderedDays(Object.values(DAYS_LIST), (item) => item.value, startOfWeek);
  // 2023-01-01 is a Sunday (getDay() === 0); offsetting by the weekday value
  // (EStartOfTheWeek SUNDAY=0..SATURDAY=6, matching Date.getDay()) yields a
  // reference date whose getDay() equals that value, for localized formatting.
  const getLocalizedWeekday = (value: EStartOfTheWeek) =>
    format(new Date(2023, 0, 1 + value), "EEE", { locale: dateFnsLocale });

  return (
    <div
      className={`relative sticky top-0 z-[1] grid divide-subtle-1 text-13 font-medium md:divide-x-[0.5px] ${
        showWeekends ? "grid-cols-7" : "grid-cols-5"
      }`}
    >
      {isLoading && (
        <div className="absolute h-[1.5px] w-3/4 animate-[bar-loader_2s_linear_infinite] bg-accent-primary" />
      )}
      {orderedDays.map((day) => {
        if (!showWeekends && (day.value === EStartOfTheWeek.SUNDAY || day.value === EStartOfTheWeek.SATURDAY))
          return null;

        return (
          <div key={day.shortTitle} className="flex h-11 items-center justify-center bg-layer-1 px-4 md:justify-end">
            {getLocalizedWeekday(day.value)}
          </div>
        );
      })}
    </div>
  );
});
