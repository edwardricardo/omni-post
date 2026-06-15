/**
 * @file queries.ts
 * @description Read-only hooks for the asset library — assets, folders, tags.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAssets, fetchFolders, fetchTags } from "./api.js";
import type { ListAssetsParams } from "./types.js";

/**
 * @hook useAssets
 * @description Fetches paginated media assets with optional folder, MIME type, and search filters.
 * @param params - Filter options: folderId, mimeType, search
 * @returns TanStack Query result with asset items and hasMore flag
 */
export function useAssets(params: ListAssetsParams) {
  return useQuery({
    queryKey: ["assets", params],
    queryFn: () => fetchAssets(params),
    staleTime: 30_000,
  });
}

/**
 * @hook useAssetFolders
 * @description Fetches all asset folders for the current account.
 * @returns TanStack Query result with asset folder array
 */
export function useAssetFolders() {
  return useQuery({
    queryKey: ["assets", "folders"],
    queryFn: fetchFolders,
    staleTime: 60_000,
  });
}

/**
 * @hook useAssetTags
 * @description Fetches all asset tags for the current account.
 * @returns TanStack Query result with asset tag array
 */
export function useAssetTags() {
  return useQuery({
    queryKey: ["assets", "tags"],
    queryFn: fetchTags,
    staleTime: 60_000,
  });
}
