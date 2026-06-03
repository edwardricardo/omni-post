/**
 * @file CrmSyncLogRepository.ts
 * @description Domain port for CRM sync log persistence. Technology-free interface.
 * @layer domain
 */

export interface CrmSyncLogData {
  id: string;
  connectionId: string;
  startedAt: Date;
  completedAt: Date | null;
  contactsSynced: number;
  activitiesSynced: number;
  errors: unknown;
  status: string;
}

export interface CreateCrmSyncLogInput {
  connectionId: string;
  status?: string;
}

export interface UpdateCrmSyncLogInput {
  completedAt?: Date;
  contactsSynced?: number;
  activitiesSynced?: number;
  errors?: unknown;
  status?: string;
}

export interface CrmSyncLogRepository {
  /** Open a new sync-log row when a CRM sync starts. */
  create(data: CreateCrmSyncLogInput): Promise<CrmSyncLogData>;
  /** Close an existing sync-log row with counters and final status. */
  update(id: string, data: UpdateCrmSyncLogInput): Promise<CrmSyncLogData>;
  /** Recent sync history for a connection (audit / debugging surface). */
  findByConnectionId(connectionId: string): Promise<CrmSyncLogData[]>;
}
