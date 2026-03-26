/**
 * @file index.ts
 * @description Barrel export for Asset Library application use cases and types.
 * @layer application
 */

export {
  CreateMediaAssetUseCase,
  type CreateMediaAssetInput,
  type CreateMediaAssetOutput,
} from "./CreateMediaAssetUseCase.js";

export {
  UpdateMediaAssetUseCase,
  type UpdateMediaAssetInput,
  type UpdateMediaAssetOutput,
} from "./UpdateMediaAssetUseCase.js";

export { DeleteMediaAssetUseCase, type DeleteMediaAssetInput } from "./DeleteMediaAssetUseCase.js";

export { TagMediaAssetUseCase, type TagMediaAssetInput } from "./TagMediaAssetUseCase.js";

export { GetMediaAssetsQuery, type GetMediaAssetsInput } from "./GetMediaAssetsQuery.js";

export { CreateAssetTagUseCase, type CreateAssetTagInput } from "./CreateAssetTagUseCase.js";

export { ListAssetTagsQuery, type ListAssetTagsInput } from "./ListAssetTagsQuery.js";

export {
  CreateAssetFolderUseCase,
  type CreateAssetFolderInput,
} from "./CreateAssetFolderUseCase.js";
