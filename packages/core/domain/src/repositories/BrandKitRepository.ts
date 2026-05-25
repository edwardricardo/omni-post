/**
 * @file BrandKitRepository.ts
 * @description Domain port for Brand Kit persistence. Technology-free interface.
 * @layer domain
 */

export interface BrandKitData {
  id: string;
  accountId: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  logoStorageKey: string | null;
  fontPrimary: string | null;
  fontSecondary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandKitRepository {
  /**
   * Find the brand kit for a given account. Returns null if none configured.
   */
  findByAccountId(accountId: string): Promise<BrandKitData | null>;

  /**
   * Upsert brand kit — create if absent, update if present.
   */
  upsert(data: Omit<BrandKitData, "id" | "createdAt" | "updatedAt">): Promise<BrandKitData>;

  /**
   * Delete the brand kit for an account.
   */
  deleteByAccountId(accountId: string): Promise<void>;
}
