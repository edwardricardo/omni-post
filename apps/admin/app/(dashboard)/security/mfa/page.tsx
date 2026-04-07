/**
 * @file page.tsx
 * @description MFA settings page that renders the MfaManager component.
 *   Uses CSS design tokens and PageHeader.
 * @layer page
 */
"use client";

import MfaManager from "@/components/security/MfaManager";
import { MfaSelfService } from "@/components/security/MfaSelfService";
import { PageHeader } from "@/components/ui/PageHeader";

export default function MfaPage() {
  return (
    <div>
      <PageHeader
        title="Multi-Factor Authentication"
        description="Manage MFA settings for admin users and system security"
      />
      <MfaSelfService />
      <div className="mt-6">
        <MfaManager />
      </div>
    </div>
  );
}
