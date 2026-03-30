/**
 * @file page.tsx
 * @description CRM integration settings page.
 * @layer client-pages
 */

"use client";

import { CrmSettings } from "@/components/settings/crm/CrmSettings";

export default function CrmSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">CRM Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sync contacts and log social media activities in your CRM.
        </p>
      </div>

      <CrmSettings />
    </div>
  );
}
