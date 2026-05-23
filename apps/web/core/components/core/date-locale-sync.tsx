/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { setDateFnsLocaleByLang } from "@plane/utils";

/**
 * Keeps the global date-fns locale holder in @plane/utils in sync with the i18n
 * current language. Renders nothing. Must be mounted INSIDE TranslationProvider
 * (so useTranslation() works) and is always mounted app-wide.
 *
 * The effect fires:
 *  - on initial mount (initial load / first client render), and
 *  - whenever `currentLocale` changes (user switches language).
 *
 * `observer` ensures this component re-renders when the mobx TranslationStore's
 * `currentLocale` observable changes, so the effect's dependency actually updates.
 */
export const DateLocaleSync = observer(function DateLocaleSync() {
  const { currentLocale } = useTranslation();

  useEffect(() => {
    setDateFnsLocaleByLang(currentLocale);
  }, [currentLocale]);

  return null;
});
