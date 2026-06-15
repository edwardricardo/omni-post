/**
 * @file api.ts
 * @description Internal fetch helpers for billing endpoints. Every helper
 *              returns the unwrapped `data` payload or throws.
 * @layer infrastructure
 */

import type {
  GatewayProvider,
  GatewayStatusDto,
  InitiateGatewaySwitchResult,
  InvoicesPage,
} from "./types.js";

export async function fetchGatewayStatus(): Promise<GatewayStatusDto> {
  const res = await fetch("/api/backend/billing/gateway/status", {
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to fetch gateway status");

  const json = (await res.json()) as { ok: boolean; data?: GatewayStatusDto };
  if (!json.ok || !json.data) throw new Error("Invalid gateway status response");

  return json.data;
}

export async function initiateGatewaySwitch(
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

export async function cancelGatewaySwitch(): Promise<void> {
  const res = await fetch("/api/backend/billing/gateway/switch", {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to cancel gateway switch");
}

export async function fetchInvoices(page: number, limit: number): Promise<InvoicesPage> {
  const res = await fetch(`/api/backend/billing/invoices?page=${page}&limit=${limit}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch invoices");
  const json = (await res.json()) as { ok: boolean; data?: InvoicesPage };
  if (!json.data) throw new Error("Invalid invoices response");
  return json.data;
}

export async function startCheckout(params: {
  gatewayProvider: GatewayProvider;
}): Promise<{ url: string }> {
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
  const json = (await res.json()) as { ok: boolean; data?: { url: string } };
  if (!json.data?.url) throw new Error("No checkout URL returned");
  return { url: json.data.url };
}

export async function openBillingPortal(): Promise<{ url: string }> {
  const res = await fetch("/api/backend/billing/portal", {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? "Portal unavailable");
  }
  const json = (await res.json()) as { ok: boolean; data?: { url: string } };
  if (!json.data?.url) throw new Error("No portal URL returned");
  return { url: json.data.url };
}
