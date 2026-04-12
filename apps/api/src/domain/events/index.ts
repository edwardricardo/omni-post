/**
 * @file index.ts
 * @description Barrel export for events — re-exports all domain events, the base event infrastructure, and event dispatcher.
 * @layer domain
 */

// Base event infrastructure
export {
  type DomainEvent,
  type DomainEventHandler,
  type EventDispatcher,
  InMemoryEventDispatcher,
} from "./DomainEvent.js";

// Post events
export {
  PostCreated,
  PostContentUpdated,
  PostScheduled,
  PostPublished,
  PostPublishingFailed,
  PostCancelled,
  PostMediaAdded,
  PostSubmittedForReview,
  PostApproved,
  PostRejected,
  type PostEvent,
} from "./PostEvents.js";

// Project events
export { type ProjectEvent } from "./ProjectEvents.js";

// Social Inbox events are co-located with their aggregates/entities:
// - SocialMessageReceived, SocialMessageRead, etc. → SocialMessageAggregate.ts
// - ConversationResolved, ConversationReopened → SocialConversation.ts
// Re-exported from aggregates/index.ts and entities/index.ts
