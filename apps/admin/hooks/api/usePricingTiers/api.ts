/**
 * @file api.ts
 * @description Internal fetch helpers for the pricing-tiers admin endpoints.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";
import type {
  CreateAccountTierInput,
  CreateBundleInput,
  CreateProviderTierInput,
  PricingData,
  TierType,
} from "./types.js";

export async function fetchPricingTiers(): Promise<PricingData> {
  const res = await fetch("/api/backend/admin/pricing/tiers", {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data?: PricingData };
  if (!json.ok || !json.data) throw new Error("Failed to fetch pricing tiers");
  return json.data;
}

export async function updateProviderTier(input: {
  id: string;
  data: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/pricing/provider-tiers/${input.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input.data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function updateAccountTier(input: {
  id: string;
  data: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/pricing/account-tiers/${input.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input.data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function updateBundle(input: {
  id: string;
  data: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/pricing/bundles/${input.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input.data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function createBundle(data: CreateBundleInput): Promise<unknown> {
  const res = await fetch("/api/backend/admin/pricing/bundles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function createProviderTier(data: CreateProviderTierInput): Promise<unknown> {
  const res = await fetch("/api/backend/admin/pricing/provider-tiers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function createAccountTier(data: CreateAccountTierInput): Promise<unknown> {
  const res = await fetch("/api/backend/admin/pricing/account-tiers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function toggleTierStatus(input: {
  type: TierType;
  id: string;
  isActive: boolean;
}): Promise<unknown> {
  const segment = input.type === "provider" ? "provider-tiers" : "account-tiers";
  const res = await fetch(`/api/backend/admin/pricing/${segment}/${input.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ isActive: input.isActive }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function deleteBundle(id: string): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/pricing/bundles/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}
