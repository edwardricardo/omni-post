/**
 * @file page.tsx
 * @component NotificationPreferencesPage
 * @description Notification preferences settings page at /dashboard/settings/notifications.
 *              Allows users to enable/disable each notification type.
 * @layer infrastructure
 */

import { getTranslations } from "next-intl/server";
import { NotificationPreferences } from "@/components/notifications/NotificationPreferences";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return {
    title: t("notifications.metaTitle"),
  };
}

export default async function NotificationPreferencesPage() {
  const t = await getTranslations("settings");

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t("notifications.title")}</h1>
        <p className="mt-1 text-sm text-gray-600">{t("notifications.subtitle")}</p>
      </div>
      <NotificationPreferences />
    </div>
  );
}
