/**
 * @file BulkScheduleRowConfirmed.ts
 * @description Domain event emitted when one row of a bulk-scheduling CSV batch is
 *   confirmed. Carries the full row intent (body, schedule, channels, media, tags)
 *   so the dispatch handler can enqueue the BullMQ job without reading back from
 *   the database. Written to the transactional outbox in the same UoW transaction
 *   as the batch manifest, guaranteeing at-least-once delivery.
 *
 *   PrismaOutboxWriter.ts checks `"toPayload" in event && typeof event.toPayload === "function"`.
 *   Without a real toPayload() the payload silently degrades to `{metadata}` and
 *   the dispatch handler loses the row intent — hence the concrete implementation.
 * @layer domain
 */

import { BaseDomainEvent } from "@core/domain/events/DomainEvent.js";
import type { MediaType } from "@core/domain/value-objects/MediaAttachment.js";

/**
 * A single media item carried in the event payload.
 */
export interface BulkScheduleRowMedia {
  readonly url: string;
  readonly type: MediaType;
}

/**
 * @class BulkScheduleRowConfirmed
 * @description Emitted once per CSV row when `ConfirmBulkScheduleUseCase` commits
 *   the batch manifest + outbox events in a single UoW transaction.
 *   - `aggregateType = "BulkScheduleItem"` — matches the outbox index key
 *     `@@index([aggregateId, aggregateType])` so reconciliation can correlate
 *     live outbox events with manifest items.
 *   - `aggregateId = itemId` (the manifest item's UUID).
 */
export class BulkScheduleRowConfirmed extends BaseDomainEvent {
  readonly eventType = "BulkScheduleRowConfirmed";
  readonly aggregateType = "BulkScheduleItem";

  constructor(
    /** The manifest item UUID — used as aggregateId for outbox correlation. */
    readonly aggregateId: string,
    /** The batch UUID. */
    readonly batchId: string,
    /** The owning account UUID. */
    readonly accountId: string,
    /** The owning project UUID. */
    readonly projectId: string,
    /** Post body / content text. */
    readonly body: string,
    /** ISO-8601 scheduled publish time. */
    readonly scheduledFor: string,
    /** IANA timezone string (e.g. "America/New_York"). */
    readonly timezone: string,
    /** Target channel IDs selected by the user at confirm time. */
    readonly channelIds: ReadonlyArray<string>,
    /** Typed media items derived from mediaUrls via extension mapping. */
    readonly media: ReadonlyArray<BulkScheduleRowMedia>,
    /** Optional content tags. */
    readonly tags: ReadonlyArray<string>,
    /** Optional post title. */
    readonly title?: string,
    version: number = 1
  ) {
    super(version);
  }

  /**
   * @method toPayload
   * @description Serializes the row intent for the outbox writer. Returns a
   *   plain Record so PrismaOutboxWriter stores the full payload JSON and the
   *   dispatch handler can reconstruct the job without a DB round-trip.
   * @returns Full row payload as a plain object.
   */
  toPayload(): Record<string, unknown> {
    return {
      itemId: this.aggregateId,
      batchId: this.batchId,
      accountId: this.accountId,
      projectId: this.projectId,
      body: this.body,
      scheduledFor: this.scheduledFor,
      timezone: this.timezone,
      channelIds: [...this.channelIds],
      media: this.media.map((m) => ({ url: m.url, type: m.type })),
      tags: [...this.tags],
      ...(this.title !== undefined && { title: this.title }),
    };
  }
}
