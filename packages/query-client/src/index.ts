/**
 * @file index.ts
 * @description Shared TanStack Query client factory. Centralizes app-wide defaults
 *              (staleTime, gcTime, retry) and global error handling via QueryCache and
 *              MutationCache callbacks. Both `apps/client` and `apps/admin` consume this
 *              factory; tests still construct their own QueryClient for isolation.
 *
 *              Pattern reference: TkDodo (TanStack Query maintainer) — global cache
 *              callbacks fire once per query event, avoiding duplicate notifications when
 *              multiple components subscribe to the same query.
 * @layer infrastructure
 */
import {
  QueryCache,
  QueryClient,
  MutationCache,
  type Query,
  type Mutation,
} from "@tanstack/react-query";

/**
 * Convenience aliases. TanStack v5 declares the QueryCache/MutationCache callbacks
 * with `unknown` for both data and error generics — exposing the same shape here
 * lets consumers pass through a handler without fighting the type system.
 */
type AnyQuery = Query<unknown, unknown, unknown, readonly unknown[]>;
type AnyMutation = Mutation<unknown, unknown, unknown, unknown>;

/**
 * Minimal logger surface this factory needs. Apps inject their `BrowserLoggerPort`
 * (or any compatible shape). Defining the shape locally avoids a hard dependency on
 * the observability package and keeps `@packages/query-client` framework-independent.
 */
export interface QueryClientLogger {
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

/**
 * Optional handlers the consumer can wire (e.g. show a toast, redirect to login on 401).
 * The factory ALWAYS logs; user handlers run after logging.
 */
export interface QueryClientHandlers {
  onQueryError?: (error: unknown, query: AnyQuery) => void;
  onMutationError?: (error: unknown, mutation: AnyMutation) => void;
}

export interface CreateAppQueryClientOptions extends QueryClientHandlers {
  /** Required: app-scoped logger so error logs include app context. */
  logger: QueryClientLogger;
  /** Optional: override default `staleTime` (default 60s). */
  staleTime?: number;
  /** Optional: override default `gcTime` (default 5min). */
  gcTime?: number;
  /** Optional: override default `retry` (default 1). */
  retry?: number;
}

const DEFAULT_STALE_TIME = 60 * 1000; // 1 minute
const DEFAULT_GC_TIME = 5 * 60 * 1000; // 5 minutes
const DEFAULT_RETRY = 1;

/**
 * Builds an app-wide `QueryClient` with shared defaults and global error handlers.
 *
 * Defaults (overridable):
 * - `staleTime`: 60s — queries are considered fresh for 60s after fetch.
 * - `gcTime`: 5min — inactive queries are garbage-collected after 5min.
 * - `retry`: 1 — failed queries retry once (conservative; tests assume <=2 attempts).
 *
 * Global error handlers (always-on):
 * - QueryCache.onError: logs `error` level with `{ queryKey, err }`.
 * - MutationCache.onError: logs `error` level with `{ mutationKey, err }`.
 * - Optional `onQueryError` / `onMutationError` consumers (e.g. toast) run AFTER logging.
 */
export function createAppQueryClient(options: CreateAppQueryClientOptions): QueryClient {
  const {
    logger,
    onQueryError,
    onMutationError,
    staleTime = DEFAULT_STALE_TIME,
    gcTime = DEFAULT_GC_TIME,
    retry = DEFAULT_RETRY,
  } = options;

  const queryCache = new QueryCache({
    onError: (error, query) => {
      logger.error("Query failed", error, {
        queryKey: query.queryKey,
      });
      onQueryError?.(error, query);
    },
  });

  const mutationCache = new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      logger.error("Mutation failed", error, {
        mutationKey: mutation.options.mutationKey,
      });
      onMutationError?.(error, mutation);
    },
  });

  return new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        staleTime,
        gcTime,
        retry,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
