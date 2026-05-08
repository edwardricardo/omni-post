/**
 * @file OutboxInbox.ts
 * @description Consumer-side dedupe service for the transactional outbox
 *              (Inbox pattern). Stores `{messageId, consumerId, processedAt}`
 *              and uses the unique PK on `messageId` to detect duplicates
 *              atomically — `tryClaimForProcessing` returns `false` when the
 *              message has already been processed by any consumer.
 *
 *              Pattern reference: event-driven.io "Outbox + Inbox patterns
 *              and delivery guarantees" (Oskar Dudycz). Outbox guarantees
 *              at-least-once delivery; the inbox guarantees at-most-once
 *              processing. Together they yield effectively-once semantics
 *              over an at-least-once substrate.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";

/**
 * Prisma error code for unique-constraint violation. Encoded as a literal
 * because pulling `Prisma.PrismaClientKnownRequestError` here would couple
 * tests to the runtime client unnecessarily.
 */
const PRISMA_UNIQUE_VIOLATION = "P2002";

export class OutboxInbox {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Attempt to mark `messageId` as processed by `consumerId`. Returns:
   *   - `true`  when the insert succeeded (caller should run the handler).
   *   - `false` when a row with that messageId already exists (skip handler).
   *
   * Any error other than the unique-constraint violation is propagated —
   * the caller decides how to handle infrastructure failures (vs. legitimate
   * dedupe-skip).
   */
  async tryClaimForProcessing(messageId: string, consumerId: string): Promise<boolean> {
    try {
      await this.prisma.outboxInbox.create({
        data: { messageId, consumerId },
      });
      return true;
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: unknown }).code === PRISMA_UNIQUE_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  }
}
