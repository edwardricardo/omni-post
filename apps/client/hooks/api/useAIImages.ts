/**
 * @file useAIImages.ts
 * @description TanStack Query hooks for AI image generation.
 * @layer infrastructure
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024";
export type ImageQuality = "standard" | "hd";
export type ImageStyle = "natural" | "vivid";

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  createdAt: string;
}

export interface GenerateImageParams {
  projectId: string;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  style: ImageStyle;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function generateImage(params: GenerateImageParams): Promise<GeneratedImage> {
  const res = await fetch("/api/backend/ai/generate-image", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to generate image");
  const data = (await res.json()) as { ok: boolean; value?: GeneratedImage };
  if (!data.ok || !data.value) throw new Error("Generation failed");
  return data.value;
}

async function fetchGeneratedImages(projectId: string): Promise<GeneratedImage[]> {
  const res = await fetch(`/api/backend/ai/generated-images?projectId=${projectId}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch generated images");
  const data = (await res.json()) as { ok: boolean; value?: GeneratedImage[] };
  return data.ok && data.value ? data.value : [];
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useGeneratedImages
 * @description Fetches previously generated AI images for a project.
 * @param projectId - The project to fetch generated images for
 * @returns TanStack Query result with generated image array
 */
export function useGeneratedImages(projectId: string) {
  return useQuery({
    queryKey: ["ai-images", projectId],
    queryFn: () => fetchGeneratedImages(projectId),
    staleTime: 60_000,
  });
}

/**
 * @hook useGenerateImage
 * @description Mutation hook for generating a new AI image. Invalidates the image list on success.
 * @param projectId - The project to associate the generated image with
 * @returns TanStack Query mutation for AI image generation
 */
export function useGenerateImage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: GenerateImageParams) => generateImage(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-images", projectId] });
    },
  });
}
