/**
 * @file GA4TrackingAdapter.ts
 * @description Infrastructure adapter implementing GA4TrackingPort.
 *   Sends events to the Google Analytics 4 Measurement Protocol via HTTP POST.
 *   Designed for graceful degradation: if GA4 credentials are not configured
 *   or if the request fails, it returns ok() so the main flow is never interrupted.
 * @layer infrastructure
 */

import { type Result, ok } from "@shared/types";
import type { GA4Event, GA4TrackingPort } from "../../domain/repositories/GA4TrackingPort.js";
import { env } from "../../config/env.js";

/**
 * Configuration for the GA4 tracking adapter, sourced from environment variables.
 */
interface GA4Config {
  /** GA4 Measurement Protocol endpoint */
  endpoint: string;
  /** GA4 Measurement ID (e.g. G-XXXXXXXXXX) */
  measurementId: string;
  /** GA4 API secret for server-side Measurement Protocol */
  apiSecret: string;
}

/**
 * @class GA4TrackingAdapter
 * @description Sends events to GA4 via the Measurement Protocol HTTP API.
 *   No-ops gracefully when environment variables are missing.
 */
export class GA4TrackingAdapter implements GA4TrackingPort {
  private readonly config: GA4Config | undefined;
  private readonly logger: { warn: (msg: string) => void; error: (msg: string) => void };

  constructor(
    logger: { warn: (msg: string) => void; error: (msg: string) => void } = {
      warn: () => {},
      error: () => {},
    }
  ) {
    this.logger = logger;

    const measurementId = env.GA4_MEASUREMENT_ID;
    const apiSecret = env.GA4_API_SECRET;

    if (measurementId && apiSecret) {
      this.config = {
        endpoint: env.GA4_ENDPOINT ?? "https://www.google-analytics.com/mp/collect",
        measurementId,
        apiSecret,
      };
    }
  }

  /**
   * @method trackEvent
   * @description Sends a GA4 event. Returns ok() even on failure to avoid
   *   breaking the main application flow.
   * @param event - The GA4 event to track
   * @returns Always Result<void, Error> with ok()
   */
  async trackEvent(event: GA4Event): Promise<Result<void, Error>> {
    if (!this.config) {
      return ok(undefined);
    }

    const clientId = event.clientId ?? this.generateClientId();

    const url = `${this.config.endpoint}?measurement_id=${encodeURIComponent(this.config.measurementId)}&api_secret=${encodeURIComponent(this.config.apiSecret)}`;

    const payload = {
      client_id: clientId,
      events: [
        {
          name: event.name,
          params: event.params,
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.warn(
          `GA4 tracking failed with status ${String(response.status)} for event "${event.name}"`
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`GA4 tracking error for event "${event.name}": ${message}`);
    }

    // Always return ok — GA4 failures must never break the main flow
    return ok(undefined);
  }

  /**
   * Generate a pseudo-random client ID for anonymous server-side events.
   */
  private generateClientId(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1_000_000_000);
    return `${String(timestamp)}.${String(random)}`;
  }
}
