/**
 * @file PrismaSocialOutboundReplyRepository.ts
 * @description Prisma adapter implementing the SocialOutboundReplyRepository port.
 *   Handles persistence and status updates for outbound reply records in the
 *   Social Inbox feature.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type $Enums } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";

import {
  type SocialOutboundReplyRepository,
  type SocialOutboundReplyDTO,
  type CreateOutboundReplyInput,
  type OutboundReplyStatusValue,
} from "@core/domain/repositories/SocialOutboundReplyRepository.js";

/**
 * Shape of a raw SocialOutboundReply row returned by Prisma queries.
 */
interface PrismaSocialOutboundReplyRow {
  id: string;
  socialMessageId: string;
  authorId: string;
  body: string;
  providerReplyId: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaSocialOutboundReplyRepository
 * @description Infrastructure adapter implementing SocialOutboundReplyRepository
 *   using Prisma ORM for PostgreSQL persistence.
 */
export class PrismaSocialOutboundReplyRepository implements SocialOutboundReplyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Creates a new outbound reply record with PENDING status.
   * @param input - The reply creation data (socialMessageId, authorId, body)
   * @returns Result containing the created SocialOutboundReplyDTO on success
   */
  async save(input: CreateOutboundReplyInput): Promise<Result<SocialOutboundReplyDTO, Error>> {
    try {
      const row = await this.prisma.socialOutboundReply.create({
        data: {
          socialMessageId: input.socialMessageId,
          authorId: input.authorId,
          body: input.body,
          status: "PENDING" as $Enums.OutboundReplyStatus,
        },
      });

      return ok(this.toDTO(row as unknown as PrismaSocialOutboundReplyRow));
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method findBySocialMessage
   * @description Finds all outbound replies for a given social message, ordered by newest first.
   * @param socialMessageId - The social message ID to query
   * @returns List of SocialOutboundReplyDTO items
   */
  async findBySocialMessage(socialMessageId: string): Promise<SocialOutboundReplyDTO[]> {
    const rows = await this.prisma.socialOutboundReply.findMany({
      where: { socialMessageId },
      orderBy: { createdAt: "desc" },
    });

    return (rows as unknown as PrismaSocialOutboundReplyRow[]).map((row) => this.toDTO(row));
  }

  /**
   * @method updateStatus
   * @description Updates the status of an outbound reply. Sets sentAt to now when
   *   status transitions to SENT. Uses conditional spread for optional fields
   *   to comply with exactOptionalPropertyTypes.
   * @param id - The reply ID
   * @param status - The new status value
   * @param providerReplyId - Optional provider reply ID (set when provider confirms delivery)
   * @param errorMessage - Optional error message (set on failure)
   * @returns Result<void> on success, Error on failure
   */
  async updateStatus(
    id: string,
    status: OutboundReplyStatusValue,
    providerReplyId?: string,
    errorMessage?: string
  ): Promise<Result<void, Error>> {
    try {
      const isSent = status === "SENT";

      await this.prisma.socialOutboundReply.update({
        where: { id },
        data: {
          status: status as $Enums.OutboundReplyStatus,
          ...(providerReplyId !== undefined && { providerReplyId }),
          ...(errorMessage !== undefined && { errorMessage }),
          ...(isSent && { sentAt: new Date() }),
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @method toDTO
   * @description Maps a raw Prisma row to a SocialOutboundReplyDTO.
   *   Casts status string to OutboundReplyStatusValue (Prisma enum values
   *   match the domain constants exactly).
   * @param row - The raw Prisma SocialOutboundReply row
   * @returns A SocialOutboundReplyDTO
   */
  private toDTO(row: PrismaSocialOutboundReplyRow): SocialOutboundReplyDTO {
    return {
      id: row.id,
      socialMessageId: row.socialMessageId,
      authorId: row.authorId,
      body: row.body,
      providerReplyId: row.providerReplyId,
      status: row.status as OutboundReplyStatusValue,
      errorMessage: row.errorMessage,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
