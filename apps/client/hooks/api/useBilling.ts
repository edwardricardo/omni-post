/**
 * @file useBilling.ts
 * @description TanStack Query hooks for billing gateway operations: fetching gateway status,
 * initiating a gateway switch (Stripe <-> Paddle), and cancelling a pending switch.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayProvider = "stripe" | "paddle";

export type PendingSwitchStatus = "SCHEDULED" | "PENDING_CHECKOUT" | "COMPLETED" | "CANCELLED";

export interface PendingSwitch {
  id: string;
  toGateway: GatewayProvider;
  status: PendingSwitchStatus;
  scheduledFor: string;
  extendedUntil: string;
}

export interface GatewayStatusDto {
  gatewayProvider: GatewayProvider;
  pendingSwitch: PendingSwitch | null;
}

export interface InitiateGatewaySwitchResult {
  switchEventId: string;
  scheduledFor: string;
  fromGateway: GatewayProvider;
  toGateway: GatewayProvider;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchGatewayStatus(): Promise<GatewayStatusDto> {
  const res = await fetch("/api/backend/api/billing/gateway/status", {
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to fetch gateway status");

  const json = (await res.json()) as { ok: boolean; data?: GatewayStatusDto };
  if (!json.ok || !json.data) throw new Error("Invalid gateway status response");

  return json.data;
}

async function initiateGatewaySwitch(
  newProvider: GatewayProvider
): Promise<InitiateGatewaySwitchResult> {
  const res = await fetch("/api/backend/api/billing/gateway/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ newProvider }),
  });

  if (!res.ok) throw new Error("Failed to initiate gateway switch");

  const json = (await res.json()) as { ok: boolean; data?: InitiateGatewaySwitchResult };
  if (!json.ok || !json.data) throw new Error("Invalid gateway switch response");

  return json.data;
}

async function cancelGatewaySwitch(): Promise<void> {
  const res = await fetch("/api/backend/api/billing/gateway/switch", {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to cancel gateway switch");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetches the current gateway provider and any pending switch.
 */
export function useGatewayStatus() {
  return useQuery({
    queryKey: ["gateway-status"],
    queryFn: fetchGatewayStatus,
    staleTime: 60_000,
  });
}

/**
 * Initiates a gateway switch to a new provider.
 * Invalidates gateway-status on success.
 */
export function useInitiateGatewaySwitch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newProvider: GatewayProvider) => initiateGatewaySwitch(newProvider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gateway-status"] });
    },
  });
}

/**
 * Cancels a pending gateway switch.
 * Invalidates gateway-status on success.
 */
export function useCancelGatewaySwitch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelGatewaySwitch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gateway-status"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Plans, Checkout & Portal
// ---------------------------------------------------------------------------

export interface BillingPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  providers: string[];
  pricePerAccountMonth: number;
  sortOrder: number;
}

/**
 * Fetches active billing plans (public, no auth).
 */
export function useAvailablePlans() {
  return useQuery({
    queryKey: ["billing", "plans"],
    queryFn: async (): Promise<BillingPlan[]> => {
      const res = await fetch("/api/backend/api/billing/plans", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch plans");
      const json = (await res.json()) as {
        ok: boolean;
        data?: { plans: BillingPlan[] };
      };
      return json.data?.plans ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Creates a checkout session and redirects to the gateway.
 */
export function useCheckout() {
  return useMutation({
    mutationFn: async (params: { gatewayProvider: GatewayProvider }): Promise<{ url: string }> => {
      const res = await fetch("/api/backend/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error ?? "Checkout failed");
      }
      const json = (await res.json()) as {
        ok: boolean;
        data?: { url: string };
      };
      if (!json.data?.url) throw new Error("No checkout URL returned");
      return { url: json.data.url };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}

/**
 * Redirects to the gateway's billing portal (manage subscription, invoices).
 */
export function useBillingPortal() {
  return useMutation({
    mutationFn: async (): Promise<{ url: string }> => {
      const res = await fetch("/api/backend/api/billing/portal", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error ?? "Portal unavailable");
      }
      const json = (await res.json()) as {
        ok: boolean;
        data?: { url: string };
      };
      if (!json.data?.url) throw new Error("No portal URL returned");
      return { url: json.data.url };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}
