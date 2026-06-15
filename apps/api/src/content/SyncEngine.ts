/**
 * @file SyncEngine.ts
 * @description Barrel re-export for the sync engine subsystem preserving backward-compatible
 *              imports from syncEngineTypes, SyncEngineBase, and SyncEngineImpl.
 * @layer infrastructure
 */

// The concrete class is what callers construct — re-export it as `SyncEngine`
// so the public name is unchanged.
export { SyncEngine } from "./SyncEngineImpl.js";

// Re-export all types so that callers importing types from this module also work
export type {
  SyncChannel,
  SyncTransaction,
  SyncChange,
  SyncConflict,
  SyncRollbackPlan,
  SyncRollbackAction,
  SyncMetrics,
  RealtimeSyncEvent,
} from "./syncEngineTypes.js";
