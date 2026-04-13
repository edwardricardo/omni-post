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
 * @hook useStartTrial
 * @description Mutation that starts a trial period for the given account.
 *   Invalidates subscriptions and accounts query caches on success.
 * @returns Mutation object with mutate({ accountId, trialDays }) and status fields
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

interface EndTrialParams {
  accountId: string;
  reason: string;
}

/**
 * @hook useEndTrial
 * @description Mutation that ends the trial period for the given account with a reason.
 *   Invalidates subscriptions and accounts query caches on success.
 * @returns Mutation object with mutate({ accountId, reason }) and status fields
 */
export function useEndTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, reason }: EndTrialParams) => {
      const res = await fetch(`/api/backend/admin/billing/accounts/${accountId}/trial/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
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
 * @hook useConvertTrial
 * @description Mutation that converts a trial account to a paid subscription.
 *   Invalidates subscriptions and accounts query caches on success.
 * @returns Mutation object with mutate({ accountId, billingCycle? }) and status fields
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
