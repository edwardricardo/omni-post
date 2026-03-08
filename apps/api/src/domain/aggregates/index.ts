/**
 * Domain Layer - Aggregates Exports
 *
 * Part of Sprint 5: DDD Architecture Implementation
 */

export { type AggregateSnapshot } from "./AggregateRoot.js";
export {
  PostAggregate,
  type CreatePostAggregateInput,
  type PostAggregateState,
} from "./PostAggregate.js";
