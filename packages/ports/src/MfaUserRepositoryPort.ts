/**
 * @file MfaUserRepositoryPort.ts
 * @description Technology-free port for the persistence a unified MFA service needs:
 *              read MFA state, save enrollment, flip the enabled flag, mark a backup
 *              code single-use, replace backup codes, and clear MFA. Method contracts
 *              take only a user id — the subject discriminator (`admin` | `customer`)
 *              lives in the service API, never in this table-shaped contract, so each
 *              concrete adapter stays single-table (SRP) and the port stays reusable.
 * @layer domain
 */

import type { Result } from "@shared/types";

/**
 * Closed set of MFA subject types. Const-object union (single source of truth,
 * runtime values, autocomplete) rather than a bare string union.
 */
export const MFA_SUBJECT_TYPE = { ADMIN: "admin", CUSTOMER: "customer" } as const;

/**
 * The kind of user an MFA operation targets.
 */
export type MfaSubjectType = (typeof MFA_SUBJECT_TYPE)[keyof typeof MFA_SUBJECT_TYPE];

/**
 * Identifies whose MFA an operation acts on: a type discriminator plus the row id.
 * The service dispatches to the matching adapter by `type`.
 */
export interface MfaSubject {
  readonly type: MfaSubjectType;
  readonly id: string;
}

/**
 * Non-secret-safe projection of a user's MFA state. `mfaBackupCodes` are argon2id
 * hashes (never plaintext); `mfaBackupUsedAt` maps a backup-code array index (as a
 * string key) to the ISO timestamp it was consumed — it carries no secret material.
 * `accountId` is present only for tenant-scoped subjects (customer); the admin
 * adapter omits it since `AdminUser` is a global table with no account scope.
 */
export interface MfaUserRecord {
  readonly id: string;
  readonly email: string;
  readonly mfaEnabled: boolean;
  readonly mfaSecret: string | null;
  readonly mfaBackupCodes: readonly string[];
  readonly mfaBackupUsedAt: Readonly<Record<string, string>>;
  readonly accountId?: string;
}

/**
 * Port for the MFA-user persistence a unified MFA service depends on.
 *
 * Consumers receive this interface by constructor injection from the composition
 * root — they never import a concrete Prisma adapter. Every method returns a
 * `Result`; a missing row is the typed `"NOT_FOUND"` error, never a thrown exception
 * across the layer boundary.
 */
export interface MfaUserRepositoryPort {
  /**
   * Read the MFA state for a user.
   *
   * @param userId - Target user primary key.
   * @returns Ok(record) when found, Err("NOT_FOUND") otherwise.
   */
  findById(userId: string): Promise<Result<MfaUserRecord, "NOT_FOUND">>;

  /**
   * Persist a fresh TOTP secret plus the hashed backup codes at setup time
   * (before MFA is enabled). Does not flip the enabled flag.
   *
   * @param userId - Target user primary key.
   * @param data - The TOTP secret and the argon2id-hashed backup codes.
   * @returns Ok(void) when applied, Err("NOT_FOUND") when the user is gone.
   */
  saveEnrollment(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string[] }
  ): Promise<Result<void, "NOT_FOUND">>;

  /**
   * Flip the `mfaEnabled` flag.
   *
   * @param userId - Target user primary key.
   * @param enabled - New enabled state.
   * @returns Ok(void) when applied, Err("NOT_FOUND") when the user is gone.
   */
  setMfaEnabled(userId: string, enabled: boolean): Promise<Result<void, "NOT_FOUND">>;

  /**
   * Mark a single backup code (by its array index) consumed at `usedAt`,
   * merging into the existing used-map so prior single-use marks are retained.
   *
   * @param userId - Target user primary key.
   * @param codeIndex - Zero-based index into `mfaBackupCodes`.
   * @param usedAt - Consumption timestamp.
   * @returns Ok(void) when applied, Err("NOT_FOUND") when the user is gone.
   */
  markBackupCodeUsed(
    userId: string,
    codeIndex: number,
    usedAt: Date
  ): Promise<Result<void, "NOT_FOUND">>;

  /**
   * Replace all backup codes with a fresh hashed set and reset the used-map to
   * empty, so every previously issued code stops working.
   *
   * @param userId - Target user primary key.
   * @param hashedCodes - The new argon2id-hashed backup codes.
   * @returns Ok(void) when applied, Err("NOT_FOUND") when the user is gone.
   */
  replaceBackupCodes(userId: string, hashedCodes: string[]): Promise<Result<void, "NOT_FOUND">>;

  /**
   * Clear all MFA state: disable, drop the secret, and empty both the backup
   * codes and the used-map.
   *
   * @param userId - Target user primary key.
   * @returns Ok(void) when applied, Err("NOT_FOUND") when the user is gone.
   */
  clearMfa(userId: string): Promise<Result<void, "NOT_FOUND">>;
}
