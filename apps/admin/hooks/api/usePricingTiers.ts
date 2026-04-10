/**
 * @file usePricingTiers.ts
 * @description TanStack Query hooks for fetching and mutating pricing tiers,
 * account tiers, and bundle configurations in the admin dashboard.
 * @layer presentation
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

export interface ProviderTier {
  id: string;
  minProviders: number;
  maxProviders: number | null;
  pricePerProviderMonth: number;
  isActive: boolean;
  effectiveFrom: string;
  createdAt: string;
}

export interface AccountTier {
  id: string;
  minAccounts: number;
  maxAccounts: number | null;
  multiplier: number;
  isActive: boolean;
  effectiveFrom: string;
  createdAt: string;
}

export interface PricingBundle {
  id: string;
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive: boolean;
  sortOrder: number;
}

interface PricingData {
  providerTiers: ProviderTier[];
  accountTiers: AccountTier[];
  bundles: PricingBundle[];
}

/**
 * @description Fetches all pricing tiers, account tiers, and bundles.
 * @returns Query result with provider tiers, account tiers, and bundles.
 */
export function usePricingTiers() {
  return useQuery({
    queryKey: ["pricing", "tiers"],
    queryFn: async (): Promise<PricingData> => {
      const res = await fetch("/api/backend/admin/pricing/tiers", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = await res.json();
      if (!json.ok || !json.data) throw new Error("Failed to fetch pricing tiers");
      return json.data;
    },
    staleTime: 300_000,
  });
}

/**
 * @description Mutation hook for updating a provider tier by ID.
 * Invalidates pricing query cache on success.
 */
export function useUpdateProviderTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/backend/admin/pricing/provider-tiers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "tiers"] }),
  });
}

/**
 * @description Mutation hook for updating an account tier by ID.
 * Invalidates pricing query cache on success.
 */
export function useUpdateAccountTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/backend/admin/pricing/account-tiers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "tiers"] }),
  });
}

/**
 * @description Mutation hook for updating a pricing bundle by ID.
 * Invalidates pricing query cache on success.
 */
export function useUpdateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/backend/admin/pricing/bundles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing", "tiers"] }),
  });
}

/**
 * @description Mutation hook for creating a new pricing bundle.
 * Invalidates pricing query cache on success.
 */
export function useCreateBundle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      slug: string;
      description: string;
      providers: string[];
      pricePerAccountMonth: number;
      isActive?: boolean;
      sortOrder?: number;
    }) => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing", "tiers"] });
    },
  });
}

/**
 * @description Mutation hook for creating a new provider tier.
 * Invalidates pricing query cache on success.
 */
export function useCreateProviderTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      minProviders: number;
      maxProviders: number | null;
      pricePerProviderMonth: number;
    }) => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing", "tiers"] });
    },
  });
}

/**
 * @description Mutation hook for creating a new account tier.
 * Invalidates pricing query cache on success.
 */
export function useCreateAccountTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      minAccounts: number;
      maxAccounts: number | null;
      multiplier: number;
    }) => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing", "tiers"] });
    },
  });
}

/**
 * @description Mutation hook for toggling the active status of a tier (provider or account).
 * Invalidates pricing query cache on success.
 */
export function useToggleTierStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      type,
      id,
      isActive,
    }: {
      type: "provider" | "account";
      id: string;
      isActive: boolean;
    }) => {
      const segment = type === "provider" ? "provider-tiers" : "account-tiers";
      const res = await fetch(`/api/backend/admin/pricing/${segment}/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing", "tiers"] });
    },
  });
}

/**
 * @description Mutation hook for deleting a pricing bundle by ID.
 * Invalidates pricing query cache on success.
 */
export function useDeleteBundle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/admin/pricing/bundles/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing", "tiers"] });
    },
  });
}
