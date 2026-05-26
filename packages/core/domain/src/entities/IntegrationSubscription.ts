/**
 * @file IntegrationSubscription.ts
 * @description Domain entity representing an integration webhook subscription.
 *   Each subscription binds a specific domain event type to a target URL
 *   that an integration platform (Zapier, Make, etc.) polls or receives push
 *   notifications on.
 * @layer domain
 */

import { ok, err, type Result } from "@shared/types";
import type { IntegrationPlatformValue } from "./IntegrationApiKey.js";

/**
 * Event types that can be subscribed to via the integration platforms.
 */
const SUPPORTED_EVENTS = [
  "post.published",
  "post.failed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "inbox.message_received",
] as const;

type IntegrationEventType = (typeof SUPPORTED_EVENTS)[number];

/**
 * Properties that fully describe an IntegrationSubscription.
 */
export interface IntegrationSubscriptionProps {
  readonly id: string;
  readonly accountId: string;
  readonly platform: IntegrationPlatformValue;
  readonly event: string;
  readonly targetUrl: string;
  readonly active: boolean;
  readonly createdAt: Date;
}

/**
 * Input required to create a new IntegrationSubscription.
 */
export interface CreateIntegrationSubscriptionInput {
  accountId: string;
  platform?: IntegrationPlatformValue;
  event: string;
  targetUrl: string;
}

/**
 * @class IntegrationSubscription
 * @description Represents a webhook subscription from an integration platform for a
 *   specific event type. Enforces HTTPS target URLs and validates event types against
 *   the supported set.
 */
export class IntegrationSubscription {
  /**
   * The list of event types available for subscription.
   */
  static readonly SUPPORTED_EVENTS = SUPPORTED_EVENTS;

  private props: IntegrationSubscriptionProps;

  private constructor(props: IntegrationSubscriptionProps) {
    this.props = props;
  }

  /**
   * @method create
   * @description Factory that validates input and produces a new subscription.
   * @param input - Account ID, event type, HTTPS target URL, and optional platform
   * @returns Result with the new entity on success, Error on validation failure
   */
  static create(input: CreateIntegrationSubscriptionInput): Result<IntegrationSubscription, Error> {
    if (!input.accountId.trim()) {
      return err(new Error("Account ID is required"));
    }

    if (!SUPPORTED_EVENTS.includes(input.event as IntegrationEventType)) {
      return err(
        new Error(`Unsupported event: ${input.event}. Supported: ${SUPPORTED_EVENTS.join(", ")}`)
      );
    }

    if (!input.targetUrl.startsWith("https://")) {
      return err(new Error("Target URL must use HTTPS"));
    }

    const platform = input.platform ?? "ZAPIER";

    return ok(
      new IntegrationSubscription({
        id: crypto.randomUUID(),
        accountId: input.accountId,
        platform,
        event: input.event,
        targetUrl: input.targetUrl,
        active: true,
        createdAt: new Date(),
      })
    );
  }

  /**
   * @method reconstitute
   * @description Rebuilds an entity from persisted data without validation.
   * @param props - The full property set from the database
   * @returns An IntegrationSubscription instance
   */
  static reconstitute(props: IntegrationSubscriptionProps): IntegrationSubscription {
    return new IntegrationSubscription(props);
  }

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get platform(): IntegrationPlatformValue {
    return this.props.platform;
  }
  get event(): string {
    return this.props.event;
  }
  get targetUrl(): string {
    return this.props.targetUrl;
  }
  get active(): boolean {
    return this.props.active;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  /**
   * @method deactivate
   * @description Marks this subscription as inactive. Idempotent.
   */
  deactivate(): void {
    if (!this.props.active) {
      return;
    }
    this.props = { ...this.props, active: false };
  }

  /**
   * @method toJSON
   * @description Serialises the entity to a plain object.
   */
  toJSON(): IntegrationSubscriptionProps {
    return { ...this.props };
  }
}
