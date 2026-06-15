/**
 * @file server.ts
 * @description MSW v2 setupServer instance for the client app's Vitest tests.
 *              Each app runs its own server with its own handlers array (admin
 *              has independent setup if/when wired).
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`.
 * @layer infrastructure
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
