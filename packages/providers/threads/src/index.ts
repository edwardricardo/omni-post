/**
 * @file index.ts
 * @description Threads (Meta) provider package barrel export. Composition root
 *   constructs the adapter via `createThreadsAdapter({ logger })`.
 * @layer infrastructure
 */

export {
  ThreadsAdapter,
  createThreadsAdapter,
  type ThreadsAdapterDeps,
  type ThreadsCredentials,
} from "./ThreadsAdapter.js";
