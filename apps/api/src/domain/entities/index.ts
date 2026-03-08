/**
 * Domain Layer - Entity Exports
 *
 * Part of Sprint 4: DDD Architecture Implementation
 * Exports all domain entities.
 *
 * Entities are objects with identity that persists over time.
 * Two entities are equal if they have the same identity, regardless of their attributes.
 */

// Base entity class
export { type EntityProps, type AuditInfo } from "./Entity.js";

// Domain entities
export {
  Channel,
  type ChannelProps,
  type CreateChannelInput,
  type ChannelCredentials,
  type ConnectionStatusValue,
  CONNECTION_STATUS,
} from "./Channel.js";

export {
  Account,
  type AccountProps,
  type CreateAccountInput,
  type SubscriptionTierValue,
  type BillingCycleValue,
  SUBSCRIPTION_TIER,
} from "./Account.js";

export {
  Project,
  type ProjectProps,
  type CreateProjectInput,
  type ProjectStats,
  type CrisisModeEntry,
} from "./Project.js";

// Link Tracking entities (Sprint 19)
export { TrackedLink, type TrackedLinkProps, type TrackedLinkCreateProps } from "./TrackedLink.js";

export { LinkClick, type LinkClickProps, type LinkClickCreateProps } from "./LinkClick.js";
