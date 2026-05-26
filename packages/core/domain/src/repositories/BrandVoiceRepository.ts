/**
 * @file BrandVoiceRepository.ts
 * @description Domain port for Brand Voice persistence. Technology-free interface.
 * @layer domain
 */

export interface BrandVoiceData {
  id: string;
  accountId: string;
  name: string;
  systemPrompt: string;
  tone: string[];
  examples: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandVoiceRepository {
  /**
   * Find the brand voice for a given account. Returns null if none configured.
   */
  findByAccountId(accountId: string): Promise<BrandVoiceData | null>;

  /**
   * Upsert brand voice — create if absent, update if present.
   */
  upsert(data: Omit<BrandVoiceData, "id" | "createdAt" | "updatedAt">): Promise<BrandVoiceData>;

  /**
   * Delete the brand voice for an account.
   */
  deleteByAccountId(accountId: string): Promise<void>;
}
