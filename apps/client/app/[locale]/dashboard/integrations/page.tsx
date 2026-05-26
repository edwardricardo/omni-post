/**
 * @file page.tsx
 * @description Integration marketplace page. Server Component — IntegrationMarketplace
 * child is the Client Component boundary.
 * @component IntegrationsPage
 * @layer infrastructure
 */

import { getTranslations } from "next-intl/server";
import { IntegrationMarketplace } from "@/components/integrations/IntegrationMarketplace";

/**
 * @component IntegrationsPage
 * @description Displays the integration marketplace for connecting OmniPost with third-party tools and services.
 */
export default async function IntegrationsPage() {
  const t = await getTranslations("integrations");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("pageSubtitle")}</p>
      </div>

      <IntegrationMarketplace />
    </div>
  );
}
