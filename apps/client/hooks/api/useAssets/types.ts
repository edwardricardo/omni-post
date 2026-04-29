/**
 * @file types.ts
 * @description Public types for the asset library hook module.
 * @layer infrastructure
 */

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

export interface AssetsPage {
  items: MediaAssetDto[];
  hasMore: boolean;
}

export interface ListAssetsParams {
  folderId?: string;
  mimeType?: string;
  search?: string;
}
