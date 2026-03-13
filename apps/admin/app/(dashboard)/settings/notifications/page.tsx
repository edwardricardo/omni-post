/**
 * @file page.tsx
 * @description Notification preferences settings page at /admin/settings/notifications.
 *              Allows users to enable/disable each notification type.
 * @layer ui
 */

import { NotificationPreferences } from "@/components/notifications/NotificationPreferences";

export const metadata = {
  title: "Notification Preferences — OmniPost Admin",
};

export default function NotificationPreferencesPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Notification Preferences</h1>
        <p className="mt-1 text-sm text-gray-600">
          Choose which notifications you receive in the notification center.
        </p>
      </div>
      <NotificationPreferences />
    </div>
  );
}
