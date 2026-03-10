/**
 * @file index.ts
 * @description Barrel export for Campaign application use cases and types.
 * @layer application
 */

export {
  type CreateCampaignInput,
  type UpdateCampaignInput,
  type CampaignPostInput,
  type CampaignAnalyticsOutput,
} from "./types.js";
export { CreateCampaignUseCase, type CreateCampaignOutput } from "./CreateCampaignUseCase.js";
export { UpdateCampaignUseCase } from "./UpdateCampaignUseCase.js";
export { ArchiveCampaignUseCase, type ArchiveCampaignInput } from "./ArchiveCampaignUseCase.js";
export { TagPostWithCampaignUseCase } from "./TagPostWithCampaignUseCase.js";
export { UntagPostFromCampaignUseCase } from "./UntagPostFromCampaignUseCase.js";
export {
  GetCampaignAnalyticsUseCase,
  type GetCampaignAnalyticsInput,
} from "./GetCampaignAnalyticsUseCase.js";
export { ListCampaignsQuery, type ListCampaignsInput } from "./ListCampaignsQuery.js";
export { GetCampaignQuery, type GetCampaignInput } from "./GetCampaignQuery.js";
