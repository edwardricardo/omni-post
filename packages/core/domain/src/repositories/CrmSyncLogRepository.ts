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
  create(data: CreateCrmSyncLogInput): Promise<CrmSyncLogData>;
  update(id: string, data: UpdateCrmSyncLogInput): Promise<CrmSyncLogData>;
  findByConnectionId(connectionId: string): Promise<CrmSyncLogData[]>;
}
