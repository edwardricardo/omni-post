/**
 * @file page.tsx
 * @description Integration marketplace page.
 * @layer client-pages
 */

"use client";

import { IntegrationMarketplace } from "@/components/integrations/IntegrationMarketplace";

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
