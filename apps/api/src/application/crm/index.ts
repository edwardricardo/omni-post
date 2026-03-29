/**
 * @file index.ts
 * @description Barrel export for CRM use cases and queries.
 * @layer application
 */

export { ConnectCrmUseCase, type ConnectCrmInput } from "./ConnectCrmUseCase.js";
export { DisconnectCrmUseCase, type DisconnectCrmInput } from "./DisconnectCrmUseCase.js";
export { GetCrmConnectionsQuery, type GetCrmConnectionsInput } from "./GetCrmConnectionsQuery.js";
export { SyncCrmContactsUseCase, type SyncCrmContactsInput } from "./SyncCrmContactsUseCase.js";
export { LogCrmActivityUseCase, type LogCrmActivityInput } from "./LogCrmActivityUseCase.js";
export { GetCrmSyncLogsQuery, type GetCrmSyncLogsInput } from "./GetCrmSyncLogsQuery.js";
