/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";
import { EmailSettingsLoader } from "@/components/ui/loader/settings/email";
import { PushNotificationSettings } from "@/components/web-push";
// services
import { UserService } from "@/services/user.service";
// local imports
import { NotificationsProfileSettingsForm } from "./email-notification-form";

const userService = new UserService();

export const NotificationsProfileSettings = observer(function NotificationsProfileSettings() {
  const { t } = useTranslation();
  // fetching user email notification settings
  const { data, isLoading } = useSWR("CURRENT_USER_EMAIL_NOTIFICATION_SETTINGS", () =>
    userService.currentUserEmailNotificationSettings()
  );

  if (!data || isLoading) {
    return <EmailSettingsLoader />;
  }

  return (
    <div className="size-full">
      {/* BARSOUL 2026-08: このページはもう「メール通知」専用ではなく、
          メール通知 + スマホ通知の 2 ブロックになったので見出しを一段上げる。 */}
      <ProfileSettingsHeading title={t("notifications")} description={t("account_settings.notifications.description")} />
      <div className="mt-7">
        <h3 className="mb-1 text-body-sm-semibold text-primary">{t("email_notifications")}</h3>
        <NotificationsProfileSettingsForm data={data} />
        {/* BARSOUL 2026-08: メール通知の下に「スマホ通知」ブロック */}
        <PushNotificationSettings />
      </div>
    </div>
  );
});
