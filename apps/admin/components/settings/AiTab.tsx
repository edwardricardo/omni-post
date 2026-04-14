/**
 * @file AiTab.tsx
 * @description Settings tab for AI provider pool configuration.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { CredentialForm } from "./CredentialForm";
import { buildFieldDefs } from "./constants";

/**
 * @component AiTab
 * @description Renders AI provider pool credential form (OpenAI, Anthropic, Gemini, Perplexity).
 */
export function AiTab() {
  const t = useTranslations("settings");

  return (
    <CredentialForm
      group="AI_POOL"
      fields={buildFieldDefs("AI_POOL", t)}
      title={t("ai.title")}
      description={t("ai.description")}
    />
  );
}
