/**
 * @file useAssets.ts
 * @description TanStack Query hooks for asset library operations.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MediaAssetDto {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  url: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  folderId: string | null;
  createdAt: string;
}

export interface AssetFolderDto {
  id: string;
  accountId: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface AssetTagDto {
  id: string;
  name: string;
  color: string;
}

export interface CreateAssetInput {
  name: string;
  url: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  description?: string;
  width?: number;
  height?: number;
  folderId?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchAssets(params: {
  folderId?: string;
  mimeType?: string;
  search?: string;
}): Promise<{ items: MediaAssetDto[]; hasMore: boolean }> {
  const searchParams = new URLSearchParams();
  if (params.folderId) searchParams.set("folderId", params.folderId);
  if (params.mimeType) searchParams.set("mimeType", params.mimeType);
  if (params.search) searchParams.set("search", params.search);

  const res = await fetch(`/api/backend/assets?${searchParams.toString()}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch assets");
  const data = (await res.json()) as {
    ok: boolean;
    value?: { items: MediaAssetDto[]; hasMore: boolean };
  };
  return data.ok && data.value ? data.value : { items: [], hasMore: false };
}

async function fetchFolders(): Promise<AssetFolderDto[]> {
  const res = await fetch("/api/backend/assets/folders", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch folders");
  const data = (await res.json()) as { ok: boolean; value?: AssetFolderDto[] };
  return data.ok && data.value ? data.value : [];
}

async function fetchTags(): Promise<AssetTagDto[]> {
  const res = await fetch("/api/backend/assets/tags", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch tags");
  const data = (await res.json()) as { ok: boolean; value?: AssetTagDto[] };
  return data.ok && data.value ? data.value : [];
}

async function createAsset(input: CreateAssetInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create asset");
  const data = (await res.json()) as { ok: boolean; value?: { id: string } };
  if (!data.ok || !data.value) throw new Error("Create failed");
  return data.value;
}

async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch(`/api/backend/assets/${assetId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete asset");
}

async function createFolder(name: string, parentId?: string): Promise<AssetFolderDto> {
  const res = await fetch("/api/backend/assets/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, ...(parentId ? { parentId } : {}) }),
  });
  if (!res.ok) throw new Error("Failed to create folder");
  const data = (await res.json()) as { ok: boolean; value?: AssetFolderDto };
  if (!data.ok || !data.value) throw new Error("Create folder failed");
  return data.value;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAssets(params: { folderId?: string; mimeType?: string; search?: string }) {
  return useQuery({
    queryKey: ["assets", params],
    queryFn: () => fetchAssets(params),
    staleTime: 30_000,
  });
}

export function useAssetFolders() {
  return useQuery({
    queryKey: ["assets", "folders"],
    queryFn: fetchFolders,
    staleTime: 60_000,
  });
}

export function useAssetTags() {
  return useQuery({
    queryKey: ["assets", "tags"],
    queryFn: fetchTags,
    staleTime: 60_000,
  });
}

export function useCreateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

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
