/**
 * @file usePrivacy.ts
 * @description Hook for submitting Data Subject Access Requests (DSAR) to the
 *              public compliance endpoint. Wraps the POST /api/compliance/dsar
 *              call via the Next.js backend proxy.
 * @layer hooks
 */

"use client";

import { useMutation } from "@tanstack/react-query";

interface DsarSubmitParams {
  email: string;
  name?: string;
  type: "EXPORT" | "DELETION" | "ACCESS";
  jurisdiction?: "GDPR" | "LGPD" | "CCPA" | "PIPEDA" | "OTHER";
  accountId?: string;
}

interface DsarSubmitResult {
  id: string;
  deadlineAt: string;
  message: string;
}

export type { DsarSubmitParams, DsarSubmitResult };

/**
 * @hook useSubmitDsarRequest
 * @description Mutation hook for submitting a Data Subject Access Request (DSAR) to the compliance endpoint.
 * @returns TanStack Query mutation with DSAR submission result including request ID and deadline
 */
export function useSubmitDsarRequest() {
  return useMutation({
    mutationFn: async (data: DsarSubmitParams): Promise<DsarSubmitResult> => {
      const res = await fetch("/api/backend/compliance/dsar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error ?? "Request failed");
      }

      const json = await res.json();
      return json.data ?? json;
    },
  });
}
