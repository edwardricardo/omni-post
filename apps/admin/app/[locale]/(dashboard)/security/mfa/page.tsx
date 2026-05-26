/**
 * @file page.tsx
 * @description MFA settings page that renders the MfaManager component.
 *   Uses CSS design tokens and PageHeader.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";

import MfaManager from "@/components/security/MfaManager";
import { MfaSelfService } from "@/components/security/MfaSelfService";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * @component MfaPage
 * @description Manages multi-factor authentication settings and self-service MFA enrollment for admin users.
 */
export default function MfaPage() {
  const ts = useTranslations("security");

  return (
    <div>
      <PageHeader title={ts("mfa.title")} description={ts("mfa.description")} />
      <MfaSelfService />
      <div className="mt-6">
        <MfaManager />
      </div>
    </div>
  );
}
