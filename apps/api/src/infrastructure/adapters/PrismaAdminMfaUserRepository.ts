/**
 * @file PrismaAdminMfaUserRepository.ts
 * @description Prisma adapter implementing MfaUserRepositoryPort against the AdminUser
 *              table. Receives PrismaClient by constructor injection and resolves the
 *              active Unit-of-Work transaction client per call so MFA state writes and
 *              their audit rows commit together. Single-table by design (SRP) — the
 *              subject discriminator lives in the service, not here.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { MfaUserRecord, MfaUserRepositoryPort } from "@ports/core";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";

/**
 * Coerce the persisted `mfaBackupUsedAt` JSON into an index→ISO string map,
 * tolerating a null/absent column or an unexpected shape (defaults to empty).
 */
function normalizeUsedAt(raw: Prisma.JsonValue | null | undefined): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * @class PrismaAdminMfaUserRepository
 * @description AdminUser-backed implementation of the MFA persistence port.
 */
export class PrismaAdminMfaUserRepository implements MfaUserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve the active UoW transaction client, else the base client. */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  async findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">> {
    const row = await this.getClient().adminUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        mfaEnabled: true,
        mfaSecret: true,
        mfaBackupCodes: true,
        mfaBackupUsedAt: true,
      },
    });
    if (!row) return err("NOT_FOUND");
    return ok({
      id: row.id,
      email: row.email,
      mfaEnabled: row.mfaEnabled,
      mfaSecret: row.mfaSecret,
      mfaBackupCodes: row.mfaBackupCodes,
      mfaBackupUsedAt: normalizeUsedAt(row.mfaBackupUsedAt),
    });
  }

  async saveEnrollment(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string[] }
  ): Promise<Result<void, "NOT_FOUND">> {
    return this.update(userId, {
      mfaSecret: data.mfaSecret,
      mfaBackupCodes: data.mfaBackupCodes,
    });
  }

  async setMfaEnabled(userId: string, enabled: boolean): Promise<Result<void, "NOT_FOUND">> {
    return this.update(userId, { mfaEnabled: enabled });
  }

  async markBackupCodeUsed(
    userId: string,
    codeIndex: number,
    usedAt: Date
  ): Promise<Result<void, "NOT_FOUND">> {
    const client = this.getClient();
    const row = await client.adminUser.findUnique({
      where: { id: userId },
      select: { mfaBackupUsedAt: true },
    });
    if (!row) return err("NOT_FOUND");
    const usedMap = normalizeUsedAt(row.mfaBackupUsedAt);
    usedMap[String(codeIndex)] = usedAt.toISOString();
    return this.update(userId, { mfaBackupUsedAt: usedMap });
  }

  async replaceBackupCodes(
    userId: string,
    hashedCodes: string[]
  ): Promise<Result<void, "NOT_FOUND">> {
    return this.update(userId, { mfaBackupCodes: hashedCodes, mfaBackupUsedAt: {} });
  }

  async clearMfa(userId: string): Promise<Result<void, "NOT_FOUND">> {
    return this.update(userId, {
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: [],
      mfaBackupUsedAt: {},
    });
  }

  /**
   * Apply a partial update, mapping a missing row (Prisma P2025) to the typed
   * NOT_FOUND result rather than a thrown exception.
   */
  private async update(
    userId: string,
    data: Prisma.AdminUserUpdateInput
  ): Promise<Result<void, "NOT_FOUND">> {
    try {
      await this.getClient().adminUser.update({ where: { id: userId }, data });
      return ok(undefined);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "P2025"
      ) {
        return err("NOT_FOUND");
      }
      throw error;
    }
  }
}
