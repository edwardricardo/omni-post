"use client";

/**
 * @file useBrandVoice.ts
 * @description TanStack Query hooks for Brand Voice Profiles.
 * @layer presentation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface BrandVoiceData {
  id: string;
  accountId: string;
  name: string;
  systemPrompt: string;
  tone: string[];
  examples: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UpsertBrandVoicePayload {
  accountId: string;
  name: string;
  systemPrompt: string;
  tone?: string[];
  examples?: string[];
  isActive?: boolean;
}

const BASE = "/api/backend/ai/brand-voice";

async function fetchBrandVoice(accountId: string): Promise<BrandVoiceData | null> {
  const res = await fetch(`${BASE}?accountId=${encodeURIComponent(accountId)}`);
  if (!res.ok) throw new Error("Failed to fetch brand voice");
  const json = (await res.json()) as { ok: boolean; data: BrandVoiceData | null };
  return json.data;
}

async function upsertBrandVoice(payload: UpsertBrandVoicePayload): Promise<BrandVoiceData> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Failed to save brand voice");
  }
  const json = (await res.json()) as { ok: boolean; data: BrandVoiceData };
  return json.data;
}

async function deleteBrandVoice(accountId: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(accountId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete brand voice");
}

/**
 * @hook useBrandVoice
 * @description Fetches the brand voice profile for a given account.
 * @param accountId - The account to fetch the brand voice for
 * @returns TanStack Query result with brand voice data or null
 */
export function useBrandVoice(accountId: string) {
  return useQuery<BrandVoiceData | null>({
    queryKey: ["brand-voice", accountId],
    queryFn: () => fetchBrandVoice(accountId),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(accountId),
  });
}

/**
 * @hook useUpsertBrandVoice
 * @description Mutation hook for creating or updating a brand voice profile.
 * @returns TanStack Query mutation that invalidates the brand voice query on success
 */
export function useUpsertBrandVoice() {
  const queryClient = useQueryClient();
  return useMutation<BrandVoiceData, Error, UpsertBrandVoicePayload>({
    mutationFn: upsertBrandVoice,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["brand-voice", data.accountId] });
    },
  });
}

/**
 * @hook useDeleteBrandVoice
 * @description Mutation hook for deleting a brand voice profile.
 * @returns TanStack Query mutation that invalidates the brand voice query on success
 */
export function useDeleteBrandVoice() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: deleteBrandVoice,
    onSuccess: (_data, accountId) => {
      void queryClient.invalidateQueries({ queryKey: ["brand-voice", accountId] });
    },
  });
}
