/**
 * @file GatewaysTab.tsx
 * @description Settings tab for payment gateway credentials (Stripe and Paddle).
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { CredentialForm } from "./CredentialForm";
import { buildFieldDefs } from "./constants";

/**
 * @component GatewaysTab
 * @description Renders Stripe and Paddle credential forms side by side.
 */
export function GatewaysTab() {
  const t = useTranslations("settings");

  return (
    <div className="space-y-4">
      <CredentialForm
        group="STRIPE"
        fields={buildFieldDefs("STRIPE", t)}
        title={t("groups.STRIPE")}
      />
      <CredentialForm
        group="PADDLE"
        fields={buildFieldDefs("PADDLE", t)}
        title={t("groups.PADDLE")}
      />
    </div>
  );
}
