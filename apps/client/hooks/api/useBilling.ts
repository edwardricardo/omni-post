/**
 * @file useBilling.ts
 * @description TanStack Query hooks for billing gateway operations: fetching gateway status,
 * initiating a gateway switch (Stripe <-> Paddle), and cancelling a pending switch.
 * @layer infrastructure
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
  const res = await fetch("/api/backend/billing/gateway/status", {
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
  const res = await fetch("/api/backend/billing/gateway/switch", {
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
  const res = await fetch("/api/backend/billing/gateway/switch", {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to cancel gateway switch");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useGatewayStatus
 * @description Fetches the current billing gateway provider and any pending switch.
 * @returns TanStack Query result with gateway status data
 */
export function useGatewayStatus() {
  return useQuery({
    queryKey: ["gateway-status"],
    queryFn: fetchGatewayStatus,
    staleTime: 60_000,
  });
}

/**
 * @hook useInitiateGatewaySwitch
 * @description Mutation hook for initiating a billing gateway switch (Stripe to Paddle or vice versa).
 * @returns TanStack Query mutation that invalidates gateway-status on success
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
 * @hook useCancelGatewaySwitch
 * @description Mutation hook for cancelling a pending billing gateway switch.
 * @returns TanStack Query mutation that invalidates gateway-status on success
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
 * @hook useAvailablePlans
 * @description Fetches active billing plans (public, no auth required).
 * @returns TanStack Query result with available billing plan array
 */
export function useAvailablePlans() {
  return useQuery({
    queryKey: ["billing", "plans"],
    queryFn: async (): Promise<BillingPlan[]> => {
      const res = await fetch("/api/backend/billing/plans", {
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
 * @hook useCheckout
 * @description Mutation hook that creates a checkout session and redirects to the payment gateway.
 * @returns TanStack Query mutation that redirects to the checkout URL on success
 */
export function useCheckout() {
  return useMutation({
    mutationFn: async (params: { gatewayProvider: GatewayProvider }): Promise<{ url: string }> => {
      const res = await fetch("/api/backend/billing/checkout", {
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
 * @hook useBillingPortal
 * @description Mutation hook that redirects to the gateway billing portal for managing subscriptions and invoices.
 * @returns TanStack Query mutation that redirects to the portal URL on success
 */
export function useBillingPortal() {
  return useMutation({
    mutationFn: async (): Promise<{ url: string }> => {
      const res = await fetch("/api/backend/billing/portal", {
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

// ---------------------------------------------------------------------------
// Invoice History
// ---------------------------------------------------------------------------

export interface InvoiceDto {
  id: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  gatewayProvider: string;
  createdAt: string;
}

/**
 * @hook useMyInvoices
 * @description Fetches paginated invoice history for the current account.
 * @param page - Page number (1-based)
 * @param limit - Items per page
 * @returns Query result with invoices array, total, page, limit
 */
export function useMyInvoices(page = 1, limit = 10) {
  return useQuery({
    queryKey: ["billing", "invoices", page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/billing/invoices?page=${page}&limit=${limit}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      const json = await res.json();
      return json.data as {
        invoices: InvoiceDto[];
        total: number;
        page: number;
        limit: number;
      };
    },
    staleTime: 60_000,
  });
}
