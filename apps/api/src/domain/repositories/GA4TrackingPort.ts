/**
 * @file GA4TrackingPort.ts
 * @description Port interface for Google Analytics 4 Measurement Protocol integration.
 *   Defines the contract for sending events to GA4 without coupling the domain
 *   to any specific HTTP client or SDK.
 * @layer domain
 */

import { type Result } from "@shared/types";

/**
 * Represents a single GA4 event to be tracked via the Measurement Protocol.
 */
export interface GA4Event {
  /** The event name (e.g. "link_click", "utm_generated") */
  name: string;
  /** Key-value parameters attached to the event */
  params: Record<string, string | number>;
  /** Optional GA4 client ID; the adapter may generate one if omitted */
  clientId?: string;
}

/**
 * Port for GA4 event tracking.
 *
 * Implementations should be resilient: GA4 tracking failures must never
 * break the main application flow. A no-op adapter is acceptable when
 * GA4 credentials are not configured.
 */
export interface GA4TrackingPort {
  /**
   * @method trackEvent
   * @description Sends a single event to GA4 Measurement Protocol.
   * @param event - The GA4 event to track
   * @returns Result<void, Error> — always ok() in graceful-degradation mode
   */
  trackEvent(event: GA4Event): Promise<Result<void, Error>>;
}
