/**
 * Application Layer - Link Tracking Types
 *
 * Part of Sprint 19: Link Tracking Feature
 * Defines DTOs for link tracking use cases.
 */

import { type ClickStats } from "../../domain/index.js";

/**
 * Input DTO for creating a tracked link
 */
export interface CreateTrackedLinkInput {
  projectId: string;
  originalUrl: string;
  vanitySlug?: string;
}

/**
 * Output DTO for a tracked link
 */
export interface TrackedLinkOutput {
  id: string;
  projectId: string;
  originalUrl: string;
  shortCode: string;
  vanitySlug?: string;
  clicks: number;
  isActive: boolean;
  createdAt: Date;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  campaignId?: string;
}

/**
 * Input for getting a link by ID
 */
export interface GetLinkInput {
  linkId: string;
}

/**
 * Input for redirect and click tracking
 */
export interface RedirectInput {
  shortCode: string;
  referrer?: string;
  userAgent?: string;
  ipAddress?: string;
  country?: string;
  city?: string;
}

/**
 * Output for redirect
 */
export interface RedirectOutput {
  originalUrl: string;
}

/**
 * Output for link statistics
 */
export interface LinkStatsOutput extends ClickStats {
  linkId: string;
  originalUrl: string;
  shortCode: string;
}

/**
 * Input for deleting a link
 */
export interface DeleteLinkInput {
  linkId: string;
}
