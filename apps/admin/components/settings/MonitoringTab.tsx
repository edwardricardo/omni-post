/**
 * @file MonitoringTab.tsx
 * @description Settings tab for Sentry monitoring configuration.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { CredentialForm } from "./CredentialForm.js";
import { buildFieldDefs } from "./constants.js";

/**
 * @component MonitoringTab
 * @description Renders Sentry monitoring credential form.
 */
export function MonitoringTab() {
  const t = useTranslations("settings");

  return (
    <CredentialForm
      group="MONITORING"
      fields={buildFieldDefs("MONITORING", t)}
      title={t("monitoring.title")}
      description={t("monitoring.description")}
    />
  );
}
