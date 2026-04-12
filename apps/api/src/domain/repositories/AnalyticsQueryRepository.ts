/**
 * @file AnalyticsQueryRepository.ts
 * @description Repository port for analytics queries — defines a CQRS-optimized read interface for fetching analytics data by post, channel, or date range.
 * @layer domain
 */

import { type Result, type DomainAnalytics } from "@shared/types";

/**
 * Date range filter for analytics queries
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Analytics Query Repository Interface
 *
 * This is a PORT in the hexagonal architecture - it defines what the domain
 * needs from analytics persistence without specifying how it's implemented.
 *
 * Uses string-based IDs because DomainAnalytics (the shared DTO) already
 * uses plain strings, keeping the query side decoupled from domain value objects.
 */
export interface AnalyticsQueryRepository {
  /**
   * Find all analytics records for a specific post
   */
  findByPostId(postId: string): Promise<DomainAnalytics[]>;

  /**
   * Find analytics records for a channel, optionally filtered by date range
   */
  findByChannelId(channelId: string, period?: DateRange): Promise<DomainAnalytics[]>;

  /**
   * Find analytics records for all channels in a project, optionally filtered by date range
   */
  findByProjectId(projectId: string, period?: DateRange): Promise<DomainAnalytics[]>;

  /**
   * Persist an analytics snapshot
   */
  save(analytics: DomainAnalytics): Promise<Result<void, Error>>;
}
