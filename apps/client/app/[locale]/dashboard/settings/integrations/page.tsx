/**
 * @file page.tsx
 * @component IntegrationsPage
 * @description Settings - Integrations page at /dashboard/settings/integrations.
 *              Manages external notification webhooks (Slack, Teams). Auth is
 *              enforced by the dashboard layout — no server-side check needed.
 *              Server Component — ExternalNotificationConfigs child is the Client
 *              Component boundary.
 * @layer infrastructure
 */

import { ExternalNotificationConfigs } from "@/components/settings/ExternalNotificationConfigs";

export default function IntegrationsPage() {
  // TODO: Replace with real project context when multi-project support is added
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
