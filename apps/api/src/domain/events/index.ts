/**
 * Domain Layer - Events Exports
 *
 * Part of Sprint 5: DDD Architecture Implementation
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
  type PostEvent,
} from "./PostEvents.js";

// Project events (Sprint 19)
export { type ProjectEvent } from "./ProjectEvents.js";
