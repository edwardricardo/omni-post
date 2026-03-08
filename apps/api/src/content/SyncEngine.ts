/**
 * SyncEngine — barrel re-export
 *
 * The implementation has been split into focused modules:
 *   - syncEngineTypes.ts   : all interfaces / type aliases
 *   - SyncEngineBase.ts    : abstract base class (state + public API)
 *   - SyncEngineImpl.ts    : concrete class with private/protected methods
 *
 * All previously-public exports are preserved here so that external
 * consumers (`content/index.ts`, `container/setup.ts`, tests) continue to
 * import from this path without any changes.
 */

// The concrete class is what callers construct — re-export it as `SyncEngine`
// so the public name is unchanged.
export { SyncEngine } from "./SyncEngineImpl";

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
} from "./syncEngineTypes";
