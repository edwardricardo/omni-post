/**
 * @file usePlatformVariants.ts
 * @description TanStack Query hook for generating platform-native content variants.
 * @layer infrastructure
 */

"use client";

import { useMutation } from "@tanstack/react-query";

export interface PlatformVariant {
  platform: string;
  content: string;
  charCount: number;
  charLimit: number;
  hashtags: string[];
}

export interface PlatformVariantsResult {
  variants: PlatformVariant[];
  generationMs: number;
}

interface GenerateVariantsInput {
  brief: string;
  platforms: string[];
  accountId: string;
  usePerformanceData?: boolean;
  tone?: string;
}

async function generateVariants(input: GenerateVariantsInput): Promise<PlatformVariantsResult> {
  const res = await fetch("/api/backend/ai/platform-variants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to generate variants");
  const data = (await res.json()) as { ok: boolean; value?: PlatformVariantsResult };
  if (!data.ok || !data.value) throw new Error("Generation failed");
  return data.value;
}

/**
 * @hook usePlatformVariants
 * @description Mutation hook for generating platform-native content variants from a brief.
 * @returns TanStack Query mutation with platform variant results and generation time
 */
export function usePlatformVariants() {
  return useMutation({
    mutationFn: generateVariants,
  });
}
