/**
 * @file PostQueryHandlers.ts
 * @description Facade that re-exports all post query handler classes and provides the createPostQueryHandlers factory function.
 * @layer application
 */

import type { PostQueryRepository } from "../../domain/index.js";
import type { Query, QueryHandler } from "@shared/cqrs";

// Re-export handler classes from sub-modules
export { GetPostQueryHandler, ListPostsQueryHandler } from "./PostQueryGetList.js";
export {
  SearchPostsQueryHandler,
  GetPostAnalyticsQueryHandler,
} from "./PostQuerySearchAnalytics.js";

// Import for factory function
import { GetPostQueryHandler, ListPostsQueryHandler } from "./PostQueryGetList.js";
import {
  SearchPostsQueryHandler,
  GetPostAnalyticsQueryHandler,
} from "./PostQuerySearchAnalytics.js";

export interface PostQueryHandlersConfig {
  postQueryRepository: PostQueryRepository;
}

/**
 * Factory function to create all post query handlers
 */
export function createPostQueryHandlers(
  config: PostQueryHandlersConfig
): QueryHandler<Query<unknown>, unknown>[] {
  return [
    new GetPostQueryHandler(config),
    new ListPostsQueryHandler(config),
    new SearchPostsQueryHandler(config),
    new GetPostAnalyticsQueryHandler(config),
  ];
}
