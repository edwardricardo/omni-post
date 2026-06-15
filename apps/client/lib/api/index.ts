/**
 * @file index.ts
 * @description Barrel export for the API layer, re-exporting the API client singleton, all TanStack Query hooks, types, and the React context provider.
 * @layer infrastructure
 */

// API Client exports
export { apiClient } from "./client.js";

// Types
export type {
  Project,
  Post,
  PostMedia,
  PostThread,
  Provider,
  ProviderCapability,
  ProviderHealth,
  Channel,
  Analytics,
  CreatePostRequest,
  UpdatePostRequest,
  PaginatedResponse,
  ApiResponse,
  HealthResponse,
  ValidationError,
  ErrorResponse,
} from "./types.js";

// React Hooks
export { useApiProviders, useAllProvidersHealth } from "./hooks.js";

// Context
export { ApiProvider } from "./context.js";
