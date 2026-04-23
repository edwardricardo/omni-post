/**
 * @file page.tsx
 * @description Integration marketplace page.
 * @layer infrastructure
 */

"use client";

import { IntegrationMarketplace } from "@/components/integrations/IntegrationMarketplace";

/**
 * @component IntegrationsPage
 * @description Displays the integration marketplace for connecting OmniPost with third-party tools and services.
 */
export default function IntegrationsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect OmniPost with your favorite tools
        </p>
      </div>

      <IntegrationMarketplace />
    </div>
  );
}
