/**
 * @file PlatformTab.tsx
 * @description Settings tab for platform identity configuration.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { CredentialForm } from "./CredentialForm.js";
import { buildFieldDefs } from "./constants.js";

/**
 * @component PlatformTab
 * @description Renders platform identity credential form (name, branding, defaults).
 */
export function PlatformTab() {
  const t = useTranslations("settings");

  return (
    <CredentialForm
      group="PLATFORM"
      fields={buildFieldDefs("PLATFORM", t)}
      title={t("platform.title")}
      description={t("platform.description")}
    />
  );
}
