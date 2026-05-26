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
  findById(id: string): Promise<CrmConnectionData | null>;
  findByAccountId(accountId: string): Promise<CrmConnectionData[]>;
  findByAccountAndPlatform(accountId: string, platform: string): Promise<CrmConnectionData | null>;
  save(data: Omit<CrmConnectionData, "id" | "createdAt" | "updatedAt">): Promise<CrmConnectionData>;
}
