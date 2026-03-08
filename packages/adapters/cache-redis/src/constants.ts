/**
 * Cache Constants
 * Predefined cache keys and TTL values for common patterns
 */

// Cache key generators for common patterns
export const CacheKeys = {
  user: (userId: string) => `user:${userId}`,
  post: (postId: string) => `post:${postId}`,
  project: (projectId: string) => `project:${projectId}`,
  analytics: (postId: string, period: string) => `analytics:${postId}:${period}`,
  media: (mediaId: string) => `media:${mediaId}`,
  timeline: (userId: string, page: number) => `timeline:${userId}:${page}`,
  search: (query: string, filters: string) =>
    `search:${Buffer.from(query + filters).toString("base64")}`,
  apiResponse: (endpoint: string, params: string) =>
    `api:${endpoint}:${Buffer.from(params).toString("base64")}`,
};

// Cache TTL constants
export const CacheTTL = {
  SHORT: 300, // 5 minutes
  MEDIUM: 1800, // 30 minutes
  LONG: 3600, // 1 hour
  VERY_LONG: 86400, // 24 hours
  WEEK: 604800, // 7 days
};
