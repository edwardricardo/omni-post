/**
 * @file page.tsx
 * @description Settings → Integrations page at /admin/settings/integrations.
 *              Manages external notification webhooks (Slack, Teams).
 * @layer ui
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@/lib/auth/backend-client";
import { ExternalNotificationConfigs } from "@/components/settings/ExternalNotificationConfigs";

export const metadata = {
  title: "Integrations — OmniPost Admin",
};

export default async function IntegrationsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/auth/login");

  const user = await verifyAccessToken(token);
  if (!user) redirect("/auth/login");

  // Use the user's default project — in a real app this would come from context
  const projectId = "default";

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
        <p className="mt-1 text-sm text-gray-600">
          Connect external services to receive notifications.
        </p>
      </div>
      <ExternalNotificationConfigs projectId={projectId} />
    </div>
  );
}
