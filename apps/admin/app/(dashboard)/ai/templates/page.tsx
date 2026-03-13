"use client";

/**
 * @file page.tsx
 * @description AI Prompt Templates management page. Lists system templates and
 *   account-specific custom templates. Users can create and delete their own templates.
 *   Requires ?accountId=<uuid> query param to scope account-specific templates.
 * @layer presentation
 */

import React from "react";
import { useSearchParams } from "next/navigation";
import { PromptTemplateManager } from "@/components/ai/PromptTemplateManager";

export default function AITemplatesPage() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId");

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Prompt Library</h1>
        <p className="text-gray-600 mt-1">
          Manage reusable AI prompt templates. System templates are read-only; create custom
          templates for your account.
        </p>
        {!accountId && (
          <p className="mt-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Append{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 rounded">
              ?accountId=&lt;uuid&gt;
            </code>{" "}
            to the URL to manage account-specific templates.
          </p>
        )}
      </div>
      <PromptTemplateManager accountId={accountId ?? ""} />
    </div>
  );
}
