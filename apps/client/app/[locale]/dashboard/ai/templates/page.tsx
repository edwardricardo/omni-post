"use client";

/**
 * @file page.tsx
 * @description AI Prompt Templates management page. Lists system templates and
 *   account-specific custom templates. Users can create and delete their own templates.
 *   Requires ?accountId=<uuid> query param to scope account-specific templates.
 * @layer infrastructure
 */

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PromptTemplateManager } from "@/components/ai/PromptTemplateManager";

/**
 * @component AITemplatesContent
 * @description Manages AI prompt templates including system templates and account-specific custom templates.
 */
function AITemplatesContent() {
  const t = useTranslations("ai");
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("templates.title")}</h1>
        <p className="text-gray-600 mt-1">{t("templates.subtitle")}</p>
        {!accountId && (
          <p className="mt-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {t.rich("templates.accountIdHint", {
              code: (chunks) => (
                <code className="font-mono text-xs bg-amber-100 px-1 rounded">{chunks}</code>
              ),
            })}
          </p>
        )}
      </div>
      <PromptTemplateManager accountId={accountId ?? ""} />
    </div>
  );
}

/**
 * @component AITemplatesPage
 * @description Entry point for the AI prompt templates page with Suspense wrapper around template management content.
 */
export default function AITemplatesPage() {
  return (
    <Suspense fallback={<TemplatesFallback />}>
      <AITemplatesContent />
    </Suspense>
  );
}

/**
 * @component TemplatesFallback
 * @description Suspense fallback shown while the templates content resolves search params.
 */
function TemplatesFallback() {
  const t = useTranslations("ai");
  return <div className="p-6 max-w-6xl mx-auto animate-pulse">{t("templates.loading")}</div>;
}
