/**
 * @file api.ts
 * @description Internal fetch helpers for the asset library endpoints.
 * @layer infrastructure
 */

import type {
  AssetFolderDto,
  AssetTagDto,
  AssetsPage,
  CreateAssetInput,
  ListAssetsParams,
} from "./types";

export async function fetchAssets(params: ListAssetsParams): Promise<AssetsPage> {
  const searchParams = new URLSearchParams();
  if (params.folderId) searchParams.set("folderId", params.folderId);
  if (params.mimeType) searchParams.set("mimeType", params.mimeType);
  if (params.search) searchParams.set("search", params.search);

  const res = await fetch(`/api/backend/assets?${searchParams.toString()}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch assets");
  const data = (await res.json()) as { ok: boolean; value?: AssetsPage };
  return data.ok && data.value ? data.value : { items: [], hasMore: false };
}

export async function fetchFolders(): Promise<AssetFolderDto[]> {
  const res = await fetch("/api/backend/assets/folders", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch folders");
  const data = (await res.json()) as { ok: boolean; value?: AssetFolderDto[] };
  return data.ok && data.value ? data.value : [];
}

export async function fetchTags(): Promise<AssetTagDto[]> {
  const res = await fetch("/api/backend/assets/tags", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch tags");
  const data = (await res.json()) as { ok: boolean; value?: AssetTagDto[] };
  return data.ok && data.value ? data.value : [];
}

export async function createAsset(input: CreateAssetInput): Promise<{ id: string }> {
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

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch(`/api/backend/assets/${assetId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete asset");
}

export async function createFolder(name: string, parentId?: string): Promise<AssetFolderDto> {
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
