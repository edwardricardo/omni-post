/**
 * @file EmailTab.tsx
 * @description Settings tab for email provider configuration (Resend).
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { CredentialForm } from "./CredentialForm.js";
import { buildFieldDefs } from "./constants.js";

/**
 * @component EmailTab
 * @description Renders Resend email credential form.
 */
export function EmailTab() {
  const t = useTranslations("settings");

  return (
    <CredentialForm
      group="RESEND"
      fields={buildFieldDefs("RESEND", t)}
      title={t("email.title")}
      description={t("email.description")}
    />
  );
}
