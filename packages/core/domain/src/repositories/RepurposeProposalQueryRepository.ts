/**
 * @file RepurposeProposalQueryRepository.ts
 * @description Read-side port for repurpose proposals: account-scoped,
 *              paginated listing returned as flat DTOs. Kept separate from
 *              the command-side RepurposeDetectionPort — the query path is
 *              independent of the detection write path (CQRS).
 * @layer domain
 */

/**
 * Flat DTO for a single repurpose proposal. Decimal engagement fields are
 * exposed as plain numbers; timestamps as ISO-8601 strings.
 */
export interface RepurposeProposalDto {
  id: string;
  sourcePostId: string;
  sourcePlatform: string;
  status: string;
  engagementRate: number;
  engagementMultiplier: number;
  detectedAt: string;
  reviewedAt: string | null;
  variantCount: number;
}

/**
 * Account-scoped pagination + optional status filter for the listing query.
 */
export interface RepurposeProposalQueryOptions {
  status?: string;
  limit: number;
  offset: number;
}

/**
 * Page of proposals plus the unpaginated total for the same filter.
 */
export interface RepurposeProposalListResult {
  proposals: RepurposeProposalDto[];
  total: number;
}

/**
 * @interface RepurposeProposalQueryRepository
 * @description Port for reading an account's repurpose proposals.
 */
export interface RepurposeProposalQueryRepository {
  /**
   * @method findByAccountId
   * @description Lists proposals for an account (newest first), optionally
   *   filtered by status, with pagination and a total count.
   */
  findByAccountId(
    accountId: string,
    options: RepurposeProposalQueryOptions
  ): Promise<RepurposeProposalListResult>;
}
