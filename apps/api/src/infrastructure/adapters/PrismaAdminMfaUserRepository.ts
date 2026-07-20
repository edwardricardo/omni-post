/**
 * @file PrismaAdminMfaUserRepository.ts
 * @description Prisma adapter implementing MfaUserRepositoryPort against the AdminUser
 *              table. Receives PrismaClient by constructor injection and resolves the
 *              active Unit-of-Work transaction client per call so MFA state writes and
 *              their audit rows commit together. Single-table by design (SRP) — the
 *              subject discriminator lives in the service, not here.
 * @layer infrastructure
 */

import { Prisma, type PrismaClient } from "@infra/prisma";
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
        mfaLastUsedTotpStep: true,
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
      mfaLastUsedTotpStep: row.mfaLastUsedTotpStep,
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
  ): Promise<Result<void, "NOT_FOUND" | "ALREADY_USED">> {
    const client = this.getClient();
    const row = await client.adminUser.findUnique({
      where: { id: userId },
      select: { mfaBackupUsedAt: true },
    });
    if (!row) return err("NOT_FOUND");
    const snapshot = row.mfaBackupUsedAt;
    const usedMap = normalizeUsedAt(snapshot);
    usedMap[String(codeIndex)] = usedAt.toISOString();
    // Compare-and-swap: advance the used-map only if it still equals the snapshot
    // we just read. A concurrent verification of the same backup code that
    // committed first leaves a different map, so this update matches zero rows —
    // the atomic single-use serializer (mirrors `claimTotpStep`). Raw SQL is
    // banned here (fitness #23); the typed JSONB `equals` filter IS the CAS.
    const { count } = await client.adminUser.updateMany({
      where: {
        id: userId,
        mfaBackupUsedAt:
          snapshot === null
            ? { equals: Prisma.AnyNull }
            : // Read `JsonValue` fed back as a write-side `InputJsonValue` filter —
              // the same bytes, distinct Prisma read/write JSON types.
              { equals: snapshot as Prisma.InputJsonValue },
      },
      data: { mfaBackupUsedAt: usedMap },
    });
    if (count === 1) return ok(undefined);
    // Count 0: a concurrent writer won the race, or the row vanished between the
    // read and the write. Disambiguate so the caller rejects — never retries.
    const existing = await client.adminUser.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return existing ? err("ALREADY_USED") : err("NOT_FOUND");
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

  async claimTotpStep(
    userId: string,
    step: number
  ): Promise<Result<"CLAIMED", "NOT_FOUND" | "ALREADY_USED">> {
    const client = this.getClient();
    // Conditional single-statement UPDATE — the concurrency serializer. Only a
    // row whose stored step is null OR strictly less than `step` matches, so a
    // replay (or an older-window token) never satisfies the WHERE.
    const { count } = await client.adminUser.updateMany({
      where: {
        id: userId,
        OR: [{ mfaLastUsedTotpStep: null }, { mfaLastUsedTotpStep: { lt: step } }],
      },
      data: { mfaLastUsedTotpStep: step },
    });
    if (count === 1) return ok("CLAIMED");
    // Count 0 disambiguation: the user is gone, or the step was already claimed.
    const existing = await client.adminUser.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return existing ? err("ALREADY_USED") : err("NOT_FOUND");
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
