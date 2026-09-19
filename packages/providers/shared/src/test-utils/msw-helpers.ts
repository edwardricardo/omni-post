/**
 * @file msw-helpers.ts
 * @description Shared MSW (Mock Service Worker) helpers for provider tests.
 *   Establishes the canonical pattern for mocking the providers' HTTP calls
 *   against recorded fixtures — an alternative to the `vi.fn()` + factory
 *   injection pattern used historically.
 *
 *   Pattern:
 *
 *   ```typescript
 *   import {
 *     createProviderMockServer,
 *     http,
 *     HttpResponse,
 *   } from "@providers/shared/test-utils/msw-helpers.js";
 *
 *   const server = createProviderMockServer([
 *     http.post("https://api.twitter.com/2/tweets", () => HttpResponse.json({...})),
 *   ]);
 *
 *   beforeAll(() => server.listen());
 *   afterEach(() => server.resetHandlers());
 *   afterAll(() => server.close());
 *   ```
 *
 *   It re-exports `http` and `HttpResponse` so tests do not have to import
 *   from `msw` directly — the wrapper allows refactoring the pattern in a
 *   single place should MSW v3 change its API.
 *
 * @layer infrastructure
 */
import { setupServer, type SetupServer } from "msw/node";
import { http, HttpResponse, type RequestHandler } from "msw";

/**
 * Creates an MSW server with the provided handlers. The handlers are lazy —
 * they resolve only when a test activates them via `server.use(...)` or
 * directly when requests arrive.
 *
 * @param handlers - List of `http.get/post/...` handlers to register.
 * @returns The SetupServer, ready for `.listen()` / `.resetHandlers()` /
 *   `.close()` in vitest hooks.
 */
export function createProviderMockServer(handlers: RequestHandler[]): SetupServer {
  return setupServer(...handlers);
}

export { http, HttpResponse };
export type { RequestHandler } from "msw";
