/**
 * @file index.ts
 * @description Barrel export for the API layer, re-exporting the API client singleton, all TanStack Query hooks, types, and the React context provider.
 */

// API Client exports
export { apiClient } from "./client";

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
  ApiError,
  ValidationError,
  ErrorResponse,
} from "./types";

// React Hooks
export { useApiProviders, useAllProvidersHealth } from "./hooks";

// Context
export { ApiProvider } from "./context";
