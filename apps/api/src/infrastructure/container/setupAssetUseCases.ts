/**
 * @file setupAssetUseCases.ts
 * @description DI registrations for Asset Library feature (Phase 2: Asset Tags).
 *              Registers Prisma repository adapters and all 8 asset use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaMediaAssetRepository } from "../repositories/PrismaMediaAssetRepository.js";
import { PrismaAssetTagRepository } from "../repositories/PrismaAssetTagRepository.js";
import { PrismaAssetFolderRepository } from "../repositories/PrismaAssetFolderRepository.js";
import {
  CreateMediaAssetUseCase,
  UpdateMediaAssetUseCase,
  DeleteMediaAssetUseCase,
  TagMediaAssetUseCase,
  GetMediaAssetsQuery,
  CreateAssetTagUseCase,
  ListAssetTagsQuery,
  CreateAssetFolderUseCase,
} from "../../application/assets/index.js";

/**
 * @function setupAssetUseCases
 * @description Registers asset library repositories and use cases into the DI container.
 * @param container - The application DI container
 */
export function setupAssetUseCases(container: Container): void {
  // -- Repositories --
  const mediaAssetRepo = new PrismaMediaAssetRepository(prisma);
  const assetTagRepo = new PrismaAssetTagRepository(prisma);
  const assetFolderRepo = new PrismaAssetFolderRepository(prisma);

  container.registerInstance(TOKENS.MediaAssetRepository, mediaAssetRepo);
  container.registerInstance(TOKENS.AssetTagRepository, assetTagRepo);
  container.registerInstance(TOKENS.AssetFolderRepository, assetFolderRepo);

  // -- Use Cases --
  container.registerInstance(
    TOKENS.CreateMediaAssetUseCase,
    new CreateMediaAssetUseCase(mediaAssetRepo)
  );
  container.registerInstance(
    TOKENS.UpdateMediaAssetUseCase,
    new UpdateMediaAssetUseCase(mediaAssetRepo)
  );
  container.registerInstance(
    TOKENS.DeleteMediaAssetUseCase,
    new DeleteMediaAssetUseCase(mediaAssetRepo)
  );
  container.registerInstance(
    TOKENS.TagMediaAssetUseCase,
    new TagMediaAssetUseCase(mediaAssetRepo, assetTagRepo)
  );
  container.registerInstance(TOKENS.GetMediaAssetsQuery, new GetMediaAssetsQuery(mediaAssetRepo));
  container.registerInstance(TOKENS.CreateAssetTagUseCase, new CreateAssetTagUseCase(assetTagRepo));
  container.registerInstance(TOKENS.ListAssetTagsQuery, new ListAssetTagsQuery(assetTagRepo));
  container.registerInstance(
    TOKENS.CreateAssetFolderUseCase,
    new CreateAssetFolderUseCase(assetFolderRepo)
  );
}
