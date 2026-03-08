/**
 * Domain Layer - TrackedLink Repository Interface (Port)
 *
 * Part of Sprint 19: Link Tracking Feature
 * Defines the contract for TrackedLink data access.
 */

import { type Result } from "@shared/types";
import { type TrackedLinkId, type ProjectId } from "../value-objects/EntityId.js";
import { type TrackedLink } from "../entities/TrackedLink.js";
import { type LinkClick } from "../entities/LinkClick.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Click statistics for a tracked link
 */
export interface ClickStats {
  totalClicks: number;
  clicksByCountry: Record<string, number>;
  clicksByDay?: Record<string, number>;
  uniqueClicks?: number;
}

/**
 * Filter options for finding links
 */
export interface TrackedLinkFilterOptions {
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * TrackedLinkRepository - Port interface for TrackedLink persistence
 *
 * This is a PORT in hexagonal architecture - it defines the contract
 * that adapters (implementations) must fulfill.
 */
export interface TrackedLinkRepository {
  /**
   * Save a tracked link (create or update)
   */
  save(link: TrackedLink): Promise<Result<void, Error>>;

  /**
   * Find a tracked link by ID
   */
  findById(id: TrackedLinkId): Promise<Result<TrackedLink, EntityNotFoundError>>;

  /**
   * Find a tracked link by short code (or vanity slug)
   */
  findByShortCode(code: string): Promise<Result<TrackedLink, EntityNotFoundError>>;

  /**
   * Find all tracked links for a project
   */
  findByProjectId(projectId: ProjectId, options?: TrackedLinkFilterOptions): Promise<TrackedLink[]>;

  /**
   * Delete a tracked link
   */
  delete(id: TrackedLinkId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Record a click event and increment the click counter
   */
  recordClick(linkId: TrackedLinkId, click: LinkClick): Promise<Result<void, Error>>;

  /**
   * Get click statistics for a link
   */
  getClickStats(linkId: TrackedLinkId): Promise<ClickStats>;

  /**
   * Check if a short code is available
   */
  isShortCodeAvailable(code: string): Promise<boolean>;
}
