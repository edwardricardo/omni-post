/**
 * Abstract Webhook Processor
 *
 * Base class for all webhook processors, providing common functionality:
 * - HMAC signature verification with timing attack prevention (Template Method pattern)
 * - Standard parse/process workflow
 * - Related entity lookup pattern
 * - Realtime broadcasting support
 *
 * Subclasses customize verification behavior by setting properties and overriding
 * hook methods rather than reimplementing the entire verification flow:
 * - `signaturePrefix`: The header prefix to strip (e.g., "sha256=", "sha1=")
 * - `signatureEncoding`: Digest encoding ("hex" or "base64")
 * - `getHmacAlgorithm()`: HMAC algorithm (default: "sha256")
 */

import { createHmac } from "crypto";
import type { WebhookProcessor } from "../webhookTypes.js";
import type { WebhookEventType, ProviderName } from "@shared/types";
import type { RealtimeWebhookBroadcaster } from "../realtimeWebhookBroadcaster.js";
import { webhookLogger } from "../../lib/logger.js";

/**
 * Related entities found from webhook data
 */
export interface RelatedEntities {
  accountId?: string;
  projectId?: string;
  postId?: string;
  channelId?: string;
}

/**
 * Normalized webhook event data
 * Each provider extends this with provider-specific fields
 */
export interface NormalizedWebhookData {
  eventType: string;
  [key: string]: unknown;
}

/**
 * Abstract base class for webhook processors
 *
 * Subclasses must provide:
 * - `providerId`: The provider identifier (e.g., "FACEBOOK", "INSTAGRAM")
 * - `signaturePrefix`: The signature header prefix (e.g., "sha256=")
 * - `signatureEncoding`: The signature encoding ("hex" or "base64")
 *
 * Subclasses may override:
 * - `parse()` and `process()` directly for full control (most common)
 * - Or implement `parsePayload()`, `resolveRelatedEntities()`, `processEvent()` hooks
 */
export abstract class AbstractWebhookProcessor implements WebhookProcessor {
  protected broadcaster?: RealtimeWebhookBroadcaster;

  /** Provider identifier (e.g., "FACEBOOK", "INSTAGRAM", "X", "TIKTOK", "YOUTUBE") */
  protected abstract providerId: ProviderName;

  /** Signature header prefix (typically "sha256=") */
  protected abstract signaturePrefix: string;

  /** Signature encoding format */
  protected abstract signatureEncoding: "hex" | "base64";

  constructor(broadcaster?: RealtimeWebhookBroadcaster) {
    if (broadcaster) {
      this.broadcaster = broadcaster;
    }
  }

  /**
   * Get the provider ID for this processor
   */
  getProviderId(): string {
    return this.providerId;
  }

  /**
   * Get the HMAC algorithm for signature verification.
   * Override in subclasses that use a different algorithm (e.g., YouTube uses SHA1).
   * @default "sha256"
   */
  protected getHmacAlgorithm(): string {
    return "sha256";
  }

  /**
   * Verify webhook signature using HMAC with constant-time comparison.
   *
   * This method implements the Template Method pattern -- subclasses customize
   * behavior by overriding hook methods (`getHmacAlgorithm()`) rather than
   * reimplementing the entire verification flow.
   *
   * Customization points:
   * - `signaturePrefix`: The header prefix to strip (e.g., "sha256=", "sha1=")
   * - `signatureEncoding`: Digest encoding ("hex" or "base64")
   * - `getHmacAlgorithm()`: HMAC algorithm (default: "sha256")
   *
   * @param payload - Raw webhook payload string
   * @param signature - Signature from webhook header
   * @param secret - Webhook secret for verification
   * @param _headers - Optional additional headers (unused in base implementation)
   * @returns true if signature is valid
   */
  verify(
    payload: string,
    signature: string,
    secret: string,
    _headers?: Record<string, string>
  ): boolean {
    try {
      if (!signature) {
        return false;
      }

      // Remove prefix if present
      const cleanSignature = signature.replace(this.signaturePrefix, "");

      // Calculate expected signature
      const expectedSignature = createHmac(this.getHmacAlgorithm(), secret)
        .update(payload, "utf8")
        .digest(this.signatureEncoding);

      // Constant-time comparison to prevent timing attacks
      return this.constantTimeCompare(cleanSignature, expectedSignature);
    } catch (error) {
      webhookLogger.error(
        { err: error, providerId: this.providerId },
        "Webhook signature verification failed"
      );
      return false;
    }
  }

  /**
   * Parse webhook payload and return normalized data with related entities.
   *
   * Subclasses typically override this method entirely with provider-specific
   * parsing logic. The default implementation delegates to `parsePayload()`
   * and `resolveRelatedEntities()` hooks.
   *
   * @param payload - Parsed webhook payload object
   * @returns Event type, normalized data, and related entities
   */
  async parse(payload: Record<string, any>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, any>;
    relatedEntities: {
      accountId?: string;
      projectId?: string;
      postId?: string;
      channelId?: string;
    };
  }> {
    // Parse provider-specific payload
    const { eventType, normalizedData } = await this.parsePayload(payload);

    // Find related database entities
    const relatedEntities = await this.resolveRelatedEntities(payload, normalizedData);

    return {
      eventType,
      normalizedData,
      relatedEntities,
    };
  }

  /**
   * Process the normalized webhook event.
   *
   * Subclasses typically override this method entirely with provider-specific
   * processing logic. The default implementation delegates to `processEvent()` hook.
   *
   * @param normalizedData - Normalized event data
   * @param relatedEntities - Related database entities
   */
  async process(normalizedData: Record<string, any>, relatedEntities: any): Promise<void> {
    const { accountId, projectId } = relatedEntities;

    if (!accountId && !projectId) {
      webhookLogger.warn(
        { providerId: this.providerId },
        "No related account or project found for webhook event"
      );
      return;
    }

    await this.processEvent(normalizedData, relatedEntities);
  }

  /**
   * Parse provider-specific webhook payload.
   * Override in subclasses that use the base class `parse()` workflow.
   * Subclasses that override `parse()` directly do not need to implement this.
   */
  protected parsePayload(_payload: Record<string, any>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, any>;
  }> {
    throw new Error(
      `${this.providerId}: parsePayload() not implemented. Override parse() or implement parsePayload().`
    );
  }

  /**
   * Find related database entities based on webhook data.
   * Override in subclasses that use the base class `parse()` workflow.
   * Subclasses that override `parse()` directly do not need to implement this.
   *
   * Named `resolveRelatedEntities` to avoid conflicts with provider-specific
   * `findRelatedEntities` methods that have different signatures.
   */
  protected resolveRelatedEntities(
    _payload: Record<string, any>,
    _normalizedData: Record<string, any>
  ): Promise<RelatedEntities> {
    throw new Error(
      `${this.providerId}: resolveRelatedEntities() not implemented. Override parse() or implement resolveRelatedEntities().`
    );
  }

  /**
   * Process the normalized webhook event.
   * Override in subclasses that use the base class `process()` workflow.
   * Subclasses that override `process()` directly do not need to implement this.
   */
  protected processEvent(
    _normalizedData: Record<string, any>,
    _relatedEntities: RelatedEntities
  ): Promise<void> {
    throw new Error(
      `${this.providerId}: processEvent() not implemented. Override process() or implement processEvent().`
    );
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   *
   * This is critical for security - naive string comparison can leak
   * information about the secret through timing differences.
   */
  protected constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Helper to broadcast post status changes via realtime
   */
  protected async broadcastPostStatusChange(
    postId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (this.broadcaster) {
      await this.broadcaster.broadcastPostStatusChange(postId, status, this.providerId, metadata);
    }
  }

  /**
   * Helper to broadcast engagement updates via realtime
   */
  protected async broadcastEngagementUpdate(
    postId: string,
    totals: Record<string, number>,
    changes: Record<string, number>
  ): Promise<void> {
    if (this.broadcaster) {
      await this.broadcaster.broadcastEngagementUpdate(postId, this.providerId, totals, changes);
    }
  }
}
