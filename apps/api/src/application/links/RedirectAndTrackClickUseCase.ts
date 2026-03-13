/**
 * Application Layer - Redirect And Track Click Use Case
 *
 * Part of Sprint 19: Link Tracking Feature
 * Handles link redirects and click tracking.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { LinkClick, type TrackedLinkRepository } from "../../domain/index.js";
import { type RedirectInput, type RedirectOutput } from "./types.js";
import { type GA4TrackingPort } from "../../domain/repositories/GA4TrackingPort.js";

/**
 * Redirect And Track Click Use Case
 *
 * Resolves a short code to original URL and records the click.
 */
export class RedirectAndTrackClickUseCase
  implements UseCase<RedirectInput, RedirectOutput, UseCaseError>
{
  constructor(
    private readonly repository: TrackedLinkRepository,
    private readonly ga4?: GA4TrackingPort
  ) {}

  async execute(input: RedirectInput): Promise<Result<RedirectOutput, UseCaseError>> {
    // Find the link by short code
    const findResult = await this.repository.findByShortCode(input.shortCode);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Link not found: ${input.shortCode}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    const link = findResult.value;

    // Check if link is active
    if (!link.isActive) {
      return err(
        new UseCaseError(`Link is no longer active: ${input.shortCode}`, USE_CASE_ERRORS.FORBIDDEN)
      );
    }

    // Create click record
    const clickResult = LinkClick.create({
      trackedLinkId: link.id,
      ...(input.referrer && { referrer: input.referrer }),
      ...(input.userAgent && { userAgent: input.userAgent }),
      ...(input.ipAddress && { ipAddress: input.ipAddress }),
      ...(input.country && { country: input.country }),
      ...(input.city && { city: input.city }),
    });

    if (!clickResult.ok) {
      return err(new UseCaseError("Failed to create click record", USE_CASE_ERRORS.INTERNAL_ERROR));
    }

    // Record the click (fire and forget for performance)
    void this.repository.recordClick(link.id, clickResult.value);

    // Fire-and-forget GA4 event — failures must never block the redirect
    void this.ga4?.trackEvent({
      name: "link_click",
      params: {
        short_code: input.shortCode,
        original_url: link.originalUrl,
        ...(input.referrer !== undefined && { referrer: input.referrer }),
        ...(input.country !== undefined && { country: input.country }),
      },
    });

    // Return the original URL
    return ok({
      originalUrl: link.originalUrl,
    });
  }
}
