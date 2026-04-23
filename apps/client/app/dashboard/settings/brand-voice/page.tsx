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
import { useSearchParams } from "next/navigation";
import { BrandVoiceForm } from "@/components/settings/BrandVoiceForm";

function BrandVoiceContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  if (!accountId) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Brand Voice</h1>
          <p className="mt-1 text-sm text-gray-600">
            Define your brand&apos;s tone and style. This profile is automatically applied to all AI
            content generation requests for the selected account.
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          No account selected. Append{" "}
          <code className="font-mono bg-amber-100 px-1 rounded">?accountId=&lt;uuid&gt;</code> to
          the URL to manage a specific account&apos;s brand voice.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Brand Voice</h1>
        <p className="mt-1 text-sm text-gray-600">
          Define your brand&apos;s tone and style. This profile is automatically applied to all AI
          content generation requests for account{" "}
          <code className="font-mono text-xs bg-gray-100 px-1 rounded">{accountId}</code>.
        </p>
      </div>
      <BrandVoiceForm accountId={accountId} />
    </div>
  );
}

export default function BrandVoicePage() {
  return (
    <Suspense fallback={<div className="max-w-2xl animate-pulse">Loading...</div>}>
      <BrandVoiceContent />
    </Suspense>
  );
}
