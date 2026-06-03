/**
 * @file CrmConnectionRepository.ts
 * @description Domain port for CRM connection persistence. Technology-free interface.
 * @layer domain
 */

export interface CrmConnectionData {
  id: string;
  accountId: string;
  platform: string;
  isActive: boolean;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  portalId: string | null;
  instanceUrl: string | null;
  sandboxMode: boolean;
  syncContacts: boolean;
  syncActivities: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrmConnectionRepository {
  /** Load a connection by id; null when absent. */
  findById(id: string): Promise<CrmConnectionData | null>;
  /** Every CRM connection an account has configured (one per platform). */
  findByAccountId(accountId: string): Promise<CrmConnectionData[]>;
  /** Look up a connection by `(accountId, platform)` — the natural unique key. */
  findByAccountAndPlatform(accountId: string, platform: string): Promise<CrmConnectionData | null>;
  /** Persist a new connection. `id`, `createdAt`, `updatedAt` are assigned by the adapter. */
  save(data: Omit<CrmConnectionData, "id" | "createdAt" | "updatedAt">): Promise<CrmConnectionData>;
}
