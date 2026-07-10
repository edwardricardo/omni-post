/**
 * @file InMemoryMfaUserRepository.ts
 * @description In-memory MfaUserRepositoryPort for unit tests. Lets the unified
 *              MfaService be exercised through the port contract with no database.
 *              Mirrors the observable semantics of the Prisma adapter: index→ISO
 *              used-map merging, replace-resets-used-map, and clear-wipes-all.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type { MfaUserRecord, MfaUserRepositoryPort } from "@ports/core";

interface MutableMfaRecord {
  id: string;
  email: string;
  accountId?: string;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaBackupCodes: string[];
  mfaBackupUsedAt: Record<string, string>;
}

/**
 * @class InMemoryMfaUserRepository
 * @description Test double implementing the MFA persistence port over a Map.
 */
export class InMemoryMfaUserRepository implements MfaUserRepositoryPort {
  private readonly rows = new Map<string, MutableMfaRecord>();

  /** Seed a user row for a test. */
  seed(record: {
    id: string;
    email: string;
    accountId?: string;
    mfaEnabled?: boolean;
    mfaSecret?: string | null;
    mfaBackupCodes?: string[];
    mfaBackupUsedAt?: Record<string, string>;
  }): void {
    this.rows.set(record.id, {
      id: record.id,
      email: record.email,
      ...(record.accountId !== undefined && { accountId: record.accountId }),
      mfaEnabled: record.mfaEnabled ?? false,
      mfaSecret: record.mfaSecret ?? null,
      mfaBackupCodes: record.mfaBackupCodes ?? [],
      mfaBackupUsedAt: record.mfaBackupUsedAt ?? {},
    });
  }

  /** Read raw stored state for assertions (e.g. hashed codes, used-map). */
  raw(id: string): MutableMfaRecord | undefined {
    const row = this.rows.get(id);
    return row ? { ...row, mfaBackupUsedAt: { ...row.mfaBackupUsedAt } } : undefined;
  }

  clear(): void {
    this.rows.clear();
  }

  async findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">> {
    const row = this.rows.get(userId);
    if (!row) return err("NOT_FOUND");
    return ok({
      id: row.id,
      email: row.email,
      ...(row.accountId !== undefined && { accountId: row.accountId }),
      mfaEnabled: row.mfaEnabled,
      mfaSecret: row.mfaSecret,
      mfaBackupCodes: [...row.mfaBackupCodes],
      mfaBackupUsedAt: { ...row.mfaBackupUsedAt },
    });
  }

  async saveEnrollment(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string[] }
  ): Promise<Result<void, "NOT_FOUND">> {
    const row = this.rows.get(userId);
    if (!row) return err("NOT_FOUND");
    row.mfaSecret = data.mfaSecret;
    row.mfaBackupCodes = [...data.mfaBackupCodes];
    return ok(undefined);
  }

  async setMfaEnabled(userId: string, enabled: boolean): Promise<Result<void, "NOT_FOUND">> {
    const row = this.rows.get(userId);
    if (!row) return err("NOT_FOUND");
    row.mfaEnabled = enabled;
    return ok(undefined);
  }

  async markBackupCodeUsed(
    userId: string,
    codeIndex: number,
    usedAt: Date
  ): Promise<Result<void, "NOT_FOUND">> {
    const row = this.rows.get(userId);
    if (!row) return err("NOT_FOUND");
    row.mfaBackupUsedAt[String(codeIndex)] = usedAt.toISOString();
    return ok(undefined);
  }

  async replaceBackupCodes(
    userId: string,
    hashedCodes: string[]
  ): Promise<Result<void, "NOT_FOUND">> {
    const row = this.rows.get(userId);
    if (!row) return err("NOT_FOUND");
    row.mfaBackupCodes = [...hashedCodes];
    row.mfaBackupUsedAt = {};
    return ok(undefined);
  }

  async clearMfa(userId: string): Promise<Result<void, "NOT_FOUND">> {
    const row = this.rows.get(userId);
    if (!row) return err("NOT_FOUND");
    row.mfaEnabled = false;
    row.mfaSecret = null;
    row.mfaBackupCodes = [];
    row.mfaBackupUsedAt = {};
    return ok(undefined);
  }
}
