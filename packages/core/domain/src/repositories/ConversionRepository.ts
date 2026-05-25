/**
 * @file ConversionRepository.ts
 * @description Repository port for conversion-event persistence and read-back —
 *              the write side of the ROI engine. `record` is idempotent; reads
 *              return Prisma-free DTOs scoped to a single account (tenancy).
 * @layer domain
 */

import type {
  ConversionDto,
  ConversionTypeKind,
  ConversionAttributionKind,
  ProviderKind,
} from "./ReadModelDtos.js";

/**
 * Input for recording a single conversion event. Enum-valued fields use the
 * DB-aligned UPPERCASE kinds; the ROI calculator maps its lowercase domain
 * literals to these at its boundary.
 */
export interface ConversionRecordInput {
  accountId: string;
  source: ProviderKind;
  contentId: string;
  conversionType: ConversionTypeKind;
  value: number;
  attribution: ConversionAttributionKind;
  occurredAt: Date;
}

/**
 * Filter options for account-scoped conversion reads.
 */
export interface ConversionFindOptions {
  start: Date;
  end: Date;
  source?: ProviderKind;
}

/**
 * ConversionRepositoryPort — write + account-scoped read access to conversions.
 *
 * Tenancy: every read is keyed by `accountId`; the port never exposes a
 * cross-account read. `record` persists a single conversion idempotently —
 * a re-report of the same event (same account, source, content, type, and
 * instant) is a no-op rather than a duplicate row.
 */
export interface ConversionRepositoryPort {
  /**
   * Persist a single conversion event. Idempotent: a duplicate of the same
   * logical event (per the natural-key unique constraint) is silently ignored.
   */
  record(input: ConversionRecordInput): Promise<void>;

  /**
   * Return an account's conversions occurring within [start, end], optionally
   * filtered by source provider, ordered by `occurredAt` ascending.
   */
  findByAccount(accountId: string, options: ConversionFindOptions): Promise<ConversionDto[]>;
}
