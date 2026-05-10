/**
 * @file index.ts
 * @description Barrel for integration test helpers — apiClient + fixtures.
 *              Smoke tests `import * as h from "../helpers"` for one-stop
 *              access to fetch wrappers, fixture builders, and assertions.
 * @layer infrastructure
 */
export * from "./apiClient.js";
export * from "./fixtures.js";
