/**
 * @file index.ts
 * @description Barrel export for the asset library hook module — preserves
 *              the public import path `@/hooks/api/useAssets`.
 * @layer infrastructure
 */

export type {
  AssetFolderDto,
  AssetTagDto,
  AssetsPage,
  CreateAssetInput,
  ListAssetsParams,
  MediaAssetDto,
} from "./types";

export { useAssetFolders, useAssetTags, useAssets } from "./queries";

export { useCreateAsset, useCreateFolder, useDeleteAsset } from "./mutations";
