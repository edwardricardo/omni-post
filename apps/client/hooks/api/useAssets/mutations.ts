/**
 * @file mutations.ts
 * @description Mutation hooks for the asset library — create asset, delete
 *              asset, create folder.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAsset, createFolder, deleteAsset } from "./api.js";

/**
 * @hook useCreateAsset
 * @description Mutation hook for uploading a new media asset.
 * @returns TanStack Query mutation that invalidates the asset list on success
 */
export function useCreateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

/**
 * @hook useDeleteAsset
 * @description Mutation hook for deleting a media asset.
 * @returns TanStack Query mutation that invalidates the asset list on success
 */
export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

/**
 * @hook useCreateFolder
 * @description Mutation hook for creating a new asset folder.
 * @returns TanStack Query mutation that invalidates the folder list on success
 */
export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      createFolder(name, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets", "folders"] });
    },
  });
}
