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
  const body = (await res.json()) as { ok: boolean; data?: AssetsPage };
  return body.ok && body.data ? body.data : { items: [], hasMore: false };
}

export async function fetchFolders(): Promise<AssetFolderDto[]> {
  const res = await fetch("/api/backend/assets/folders", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch folders");
  const body = (await res.json()) as { ok: boolean; data?: AssetFolderDto[] };
  return body.ok && body.data ? body.data : [];
}

export async function fetchTags(): Promise<AssetTagDto[]> {
  const res = await fetch("/api/backend/assets/tags", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch tags");
  const body = (await res.json()) as { ok: boolean; data?: AssetTagDto[] };
  return body.ok && body.data ? body.data : [];
}

export async function createAsset(input: CreateAssetInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create asset");
  const body = (await res.json()) as { ok: boolean; data?: { id: string } };
  if (!body.ok || !body.data) throw new Error("Create failed");
  return body.data;
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
  const body = (await res.json()) as { ok: boolean; data?: AssetFolderDto };
  if (!body.ok || !body.data) throw new Error("Create folder failed");
  return body.data;
}
