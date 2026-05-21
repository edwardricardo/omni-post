"use client";

/**
 * @file page.tsx
 * @component BrandVoicePage
 * @description Settings - Brand Voice page at /dashboard/settings/brand-voice.
 *              Allows configuring a custom AI system prompt for a specific account.
 *              The accountId is read from the URL search params. Auth is enforced
 *              by the dashboard layout — no server-side check needed.
 * @layer infrastructure
 */

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BrandVoiceForm } from "@/components/settings/BrandVoiceForm";

function BrandVoiceContent() {
  const t = useTranslations("settings");
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  if (!accountId) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">{t("brandVoice.title")}</h1>
          <p className="mt-1 text-sm text-gray-600">{t("brandVoice.descriptionNoAccount")}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {t.rich("brandVoice.noAccountSelected", {
            code: (chunks) => <code className="font-mono bg-amber-100 px-1 rounded">{chunks}</code>,
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t("brandVoice.title")}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {t.rich("brandVoice.descriptionWithAccount", {
            code: () => (
              <code className="font-mono text-xs bg-gray-100 px-1 rounded">{accountId}</code>
            ),
          })}
        </p>
      </div>
      <BrandVoiceForm accountId={accountId} />
    </div>
  );
}

export default function BrandVoicePage() {
  const t = useTranslations("settings");
  return (
    <Suspense fallback={<div className="max-w-2xl animate-pulse">{t("brandVoice.loading")}</div>}>
      <BrandVoiceContent />
    </Suspense>
  );
}
