/**
 * @file page.tsx
 * @component CrmSettingsPage
 * @description CRM integration settings page. Server Component — CrmSettings child is
 * the Client Component boundary.
 * @layer infrastructure
 */

import { getTranslations } from "next-intl/server";
import { CrmSettings } from "@/components/settings/crm/CrmSettings";

export default async function CrmSettingsPage() {
  const t = await getTranslations("settings");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("crm.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("crm.subtitle")}</p>
      </div>

      <CrmSettings />
    </div>
  );
}
