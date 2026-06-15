/**
 * @file index.ts
 * @description Barrel export for the campaigns hook module — preserves
 *              the public import path `@/hooks/api/useCampaigns`.
 * @layer infrastructure
 */

export type {
  CampaignAnalyticsDto,
  CampaignDto,
  CampaignStatus,
  CreateCampaignInput,
} from "./types.js";

export { useCampaign, useCampaignAnalytics, useCampaigns } from "./queries.js";

export { useArchiveCampaign, useCreateCampaign } from "./mutations.js";
