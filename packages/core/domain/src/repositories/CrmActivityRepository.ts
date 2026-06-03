/**
 * @file CrmActivityRepository.ts
 * @description Domain port for CRM activity persistence. Technology-free interface.
 * @layer domain
 */

export interface CrmActivityData {
  id: string;
  accountId: string;
  platform: string;
  externalId: string | null;
  type: string;
  title: string;
  description: string | null;
  occurredAt: Date;
  contactEmail: string | null;
  postId: string | null;
  campaignId: string | null;
  syncedAt: Date | null;
  syncError: string | null;
  createdAt: Date;
}

export interface CreateCrmActivityInput {
  accountId: string;
  platform: string;
  type: string;
  title: string;
  description?: string | null;
  occurredAt: Date;
  contactEmail?: string | null;
  postId?: string | null;
  campaignId?: string | null;
}

export interface CrmActivityRepository {
  /** Persist a pending CRM activity. Sync to the external CRM happens later via a worker. */
  save(data: CreateCrmActivityInput): Promise<CrmActivityData>;
  /** List activities for an account whose `syncedAt` is null — the worker's pending queue. */
  findUnsyncedByAccountId(accountId: string): Promise<CrmActivityData[]>;
  /** Mark an activity as successfully synced, stamping the external id when available. */
  markSynced(id: string, externalId: string | null): Promise<void>;
}
