/**
 * @file useSubscriptionMutations.ts
 * @description TanStack Query mutation hooks for subscription management:
 *   start trial, end trial, and convert trial to paid subscription.
 * @layer presentation
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

interface StartTrialParams {
  accountId: string;
  trialDays: number;
}

interface ConvertTrialParams {
  accountId: string;
  billingCycle?: "monthly" | "yearly";
}

/**
 * @description Starts a trial for the given account.
 */
export function useStartTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, trialDays }: StartTrialParams) => {
      const res = await fetch(`/api/backend/admin/billing/accounts/${accountId}/trial/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trialDays }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

/**
 * @description Ends the trial for the given account.
 */
export function useEndTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(`/api/backend/admin/billing/accounts/${accountId}/trial/end`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

/**
 * @description Converts a trial account to a paid subscription.
 */
export function useConvertTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, billingCycle }: ConvertTrialParams) => {
      const res = await fetch(`/api/backend/admin/billing/accounts/${accountId}/trial/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(billingCycle !== undefined && { billingCycle }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}
