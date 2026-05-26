/**
 * @file SocialOutboundReplyRepository.ts
 * @description Repository port for SocialOutboundReply persistence.
 * @layer domain
 */

import { type Result } from "@shared/types";

/**
 * Outbound reply status values.
 */
export const OUTBOUND_REPLY_STATUSES = {
  PENDING: "PENDING",
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED: "FAILED",
} as const;

export type OutboundReplyStatusValue =
  (typeof OUTBOUND_REPLY_STATUSES)[keyof typeof OUTBOUND_REPLY_STATUSES];

/**
 * DTO for outbound reply records.
 */
export interface SocialOutboundReplyDTO {
  id: string;
  socialMessageId: string;
  authorId: string;
  body: string;
  providerReplyId: string | null;
  status: OutboundReplyStatusValue;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating an outbound reply.
 */
export interface CreateOutboundReplyInput {
  socialMessageId: string;
  authorId: string;
  body: string;
}

/**
 * @interface SocialOutboundReplyRepository
 * @description Repository port for managing outbound reply records.
 */
export interface SocialOutboundReplyRepository {
  /**
   * @method save
   * @description Create a new outbound reply record.
   * @param input - The reply data
   * @returns Result containing the created reply DTO on success
   */
  save(input: CreateOutboundReplyInput): Promise<Result<SocialOutboundReplyDTO, Error>>;

  /**
   * @method findBySocialMessage
   * @description Find all outbound replies for a social message.
   * @param socialMessageId - The social message ID
   * @returns List of outbound reply DTOs
   */
  findBySocialMessage(socialMessageId: string): Promise<SocialOutboundReplyDTO[]>;

  /**
   * @method updateStatus
   * @description Update the status of an outbound reply (e.g. PENDING → SENT).
   * @param id - The reply ID
   * @param status - The new status
   * @param providerReplyId - Optional provider reply ID (set on success)
   * @param errorMessage - Optional error message (set on failure)
   * @returns Result<void> on success, Error on failure
   */
  updateStatus(
    id: string,
    status: OutboundReplyStatusValue,
    providerReplyId?: string,
    errorMessage?: string
  ): Promise<Result<void, Error>>;
}
