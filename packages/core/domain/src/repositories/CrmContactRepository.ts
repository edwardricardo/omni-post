/**
 * @file CrmContactRepository.ts
 * @description Domain port for CRM contact persistence. Technology-free interface.
 * @layer domain
 */

export interface CrmContactData {
  id: string;
  accountId: string;
  platform: string;
  externalId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  syncedAt: Date;
  updatedAt: Date;
}

export interface UpsertCrmContactInput {
  accountId: string;
  platform: string;
  externalId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
}

export interface CrmContactRepository {
  upsertMany(contacts: UpsertCrmContactInput[]): Promise<number>;
  findByAccountId(accountId: string): Promise<CrmContactData[]>;
}
