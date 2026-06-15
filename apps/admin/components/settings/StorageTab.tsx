/**
 * @file StorageTab.tsx
 * @description Settings tab for S3-compatible object storage configuration.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { CredentialForm } from "./CredentialForm.js";
import { buildFieldDefs } from "./constants.js";

/**
 * @component StorageTab
 * @description Renders object storage credential form.
 */
export function StorageTab() {
  const t = useTranslations("settings");

  return (
    <CredentialForm
      group="STORAGE"
      fields={buildFieldDefs("STORAGE", t)}
      title={t("storage.title")}
      description={t("storage.description")}
    />
  );
}
