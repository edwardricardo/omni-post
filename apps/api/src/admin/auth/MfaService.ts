/**
 * @file MfaService.ts
 * @description Unified, port-based multi-factor authentication service. One instance
 *              serves both admin and customer subjects: it dispatches by
 *              `MfaSubject.type` to the matching MfaUserRepositoryPort adapter and
 *              covers setup, TOTP + single-use backup-code verification, backup-code
 *              regeneration, self- and admin-force-disable, and status. Backup codes
 *              are hashed only through the canonical argon2id helper; the TOTP window
 *              is pinned per call without mutating global otplib state; MFA state and
 *              its audit trail are written together under the Unit of Work.
 * @layer infrastructure
 */

import crypto from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { ok, err, isErr, type Result } from "@shared/types";
import { MFA_SUBJECT_TYPE, type MfaSubject, type MfaUserRepositoryPort } from "@ports/core";
import type { AuditLogRepository } from "@core/domain/repositories/AuditLogRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { AuditableService, auditActor, type AuditActor } from "../../services/AuditableService.js";
import { authLogger } from "../../lib/logger.js";
import { hashPassword, verifyPassword } from "../../auth/passwordHashing.js";
import { adminAuthConfig } from "./adminAuthConfig.js";

/**
 * TOTP window (± time steps) tolerated on verification. Pinned per call — never
 * assigned to the shared `authenticator.options` — so the service holds no
 * mutable global state. Value preserves the legacy service's effective behavior.
 */
const TOTP_WINDOW = 2;

/**
 * Backup code encoding: 8 characters of uppercase hex (`crypto.randomBytes(4)`).
 * Pinned to 8 chars because route token schemas cap at 8 and backfilled admin
 * hashes derive from 8-char codes users still hold.
 */
const BACKUP_CODE_BYTES = 4;

/**
 * Plaintext MFA setup payload returned to the caller exactly once. The plaintext
 * backup codes are never re-derivable from storage (only their hashes persist).
 */
export interface MfaSetupData {
  secret: string;
  backupCodes: string[];
  qrCodeUrl: string;
  manualEntryKey: string;
}

/**
 * Outcome of a login-time MFA verification: whether it verified, and whether a
 * single-use backup code (rather than a TOTP) was consumed.
 */
export interface MfaVerificationResult {
  verified: boolean;
  usedBackupCode: boolean;
}

/**
 * The admin actor performing a force-disable — recorded in the audit trail.
 */
export interface MfaActor {
  readonly id: string;
}

type SetupError = "USER_NOT_FOUND" | "MFA_ALREADY_ENABLED" | "DATABASE_ERROR";
type VerifySetupError =
  | "USER_NOT_FOUND"
  | "INVALID_TOKEN"
  | "MFA_ALREADY_ENABLED"
  | "NO_SETUP_IN_PROGRESS"
  | "DATABASE_ERROR";
type VerifyTokenError = "USER_NOT_FOUND" | "MFA_NOT_ENABLED" | "INVALID_TOKEN" | "DATABASE_ERROR";
type ForceDisableError = "USER_NOT_FOUND" | "DATABASE_ERROR";
type StatusError = "USER_NOT_FOUND" | "DATABASE_ERROR";

/**
 * @class MfaService
 * @description Subject-agnostic MFA orchestrator. Receives one adapter per subject
 *              type plus the audit port and (optionally) a Unit of Work by
 *              constructor injection — it never imports a Prisma singleton nor
 *              constructs an adapter inline.
 */
export class MfaService extends AuditableService {
  private readonly issuer = adminAuthConfig.mfa.issuer;
  private readonly backupCodesCount = adminAuthConfig.mfa.backupCodesCount;

  constructor(
    private readonly adminRepo: MfaUserRepositoryPort,
    private readonly customerRepo: MfaUserRepositoryPort,
    auditLog: AuditLogRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {
    super("MfaService", auditLog);
  }

  /**
   * @method setupMfa
   * @description Issue a TOTP secret plus a fresh set of single-use backup codes
   *              for a subject with no MFA enrolled. Hashes are persisted; the
   *              plaintext codes are returned exactly once. The TOTP key URI
   *              label is derived from the subject's own `MfaUserRecord.email`
   *              (already loaded via `findById`) — never from a caller-supplied
   *              value, since `CustomerRequestUser` carries no email field.
   * @param subject - The admin or customer subject to enroll.
   * @returns Ok(setup) with the plaintext codes, or a typed setup error.
   */
  async setupMfa(subject: MfaSubject): Promise<Result<MfaSetupData, SetupError>> {
    try {
      const repo = this.repoFor(subject);
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");
      if (found.value.mfaEnabled) return err("MFA_ALREADY_ENABLED");

      const secret = authenticator.generateSecret();
      const backupCodes = this.generateBackupCodes();
      const hashedBackupCodes = await Promise.all(backupCodes.map((code) => hashPassword(code)));

      const saved = await repo.saveEnrollment(subject.id, {
        mfaSecret: secret,
        mfaBackupCodes: hashedBackupCodes,
      });
      if (isErr(saved)) return err("USER_NOT_FOUND");

      const otpauthUrl = authenticator.keyuri(found.value.email, this.issuer, secret);
      const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

      await this.audit(subject, "MFA_SETUP_INITIATED", "MEDIUM", undefined, found.value.accountId);

      return ok({ secret, backupCodes, qrCodeUrl, manualEntryKey: secret });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA setup error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method verifyMfaSetup
   * @description Verify the first TOTP and flip `mfaEnabled` on. Backup codes are
   *              NOT re-issued here — they were returned once at setup.
   * @param subject - The subject completing setup.
   * @param token - A current TOTP.
   * @returns Ok with an empty backup-code list, or a typed verify-setup error.
   */
  async verifyMfaSetup(
    subject: MfaSubject,
    token: string
  ): Promise<Result<{ backupCodes: string[] }, VerifySetupError>> {
    try {
      const repo = this.repoFor(subject);
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");
      const record = found.value;
      if (record.mfaEnabled) return err("MFA_ALREADY_ENABLED");
      if (!record.mfaSecret) return err("NO_SETUP_IN_PROGRESS");

      if (!this.verifyTotp(token, record.mfaSecret)) {
        await this.audit(
          subject,
          "MFA_SETUP_FAILED",
          "MEDIUM",
          {
            reason: "INVALID_TOKEN",
          },
          record.accountId
        );
        return err("INVALID_TOKEN");
      }

      await this.runInTransaction(async () => {
        const enabled = await repo.setMfaEnabled(subject.id, true);
        if (isErr(enabled)) throw new Error("USER_NOT_FOUND");
        await this.audit(subject, "MFA_ENABLED", "HIGH", undefined, record.accountId);
      });

      // Backup codes are issued exactly once at setup; do not re-derive them.
      return ok({ backupCodes: [] });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA verify-setup error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method verifyMfaToken
   * @description Login-time verification. Tries the TOTP first; on a miss, checks
   *              each UNUSED backup-code hash and, on a match, marks that code
   *              single-use (by array index) so it cannot be presented again.
   * @param subject - The subject verifying.
   * @param token - A TOTP or a backup code.
   * @returns Ok({verified,usedBackupCode}) on success, or a typed verify error.
   */
  async verifyMfaToken(
    subject: MfaSubject,
    token: string
  ): Promise<Result<MfaVerificationResult, VerifyTokenError>> {
    try {
      const repo = this.repoFor(subject);
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");
      const record = found.value;
      if (!record.mfaEnabled || !record.mfaSecret) return err("MFA_NOT_ENABLED");

      if (this.verifyTotp(token, record.mfaSecret)) {
        return ok({ verified: true, usedBackupCode: false });
      }

      const usedIndexes = new Set(Object.keys(record.mfaBackupUsedAt));
      for (let index = 0; index < record.mfaBackupCodes.length; index++) {
        if (usedIndexes.has(String(index))) continue;
        const hash = record.mfaBackupCodes[index];
        if (!hash) continue;
        if (await verifyPassword(hash, token)) {
          const remaining = record.mfaBackupCodes.length - usedIndexes.size - 1;
          await this.runInTransaction(async () => {
            const marked = await repo.markBackupCodeUsed(subject.id, index, new Date());
            if (isErr(marked)) throw new Error("USER_NOT_FOUND");
            await this.audit(
              subject,
              "MFA_BACKUP_CODE_USED",
              "MEDIUM",
              { remainingCodes: remaining },
              record.accountId
            );
          });
          return ok({ verified: true, usedBackupCode: true });
        }
      }

      await this.audit(
        subject,
        "MFA_VERIFICATION_FAILED",
        "MEDIUM",
        { tokenLength: token.length },
        record.accountId
      );
      return err("INVALID_TOKEN");
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA token verification error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method regenerateBackupCodes
   * @description Requires a valid current token, then replaces every backup code
   *              with a fresh hashed set (old codes stop working).
   * @param subject - The enrolled subject.
   * @param token - A valid TOTP or unused backup code.
   * @returns Ok(plaintextCodes) returned once, or a typed verify error.
   */
  async regenerateBackupCodes(
    subject: MfaSubject,
    token: string
  ): Promise<Result<string[], VerifyTokenError>> {
    try {
      const verification = await this.verifyMfaToken(subject, token);
      if (isErr(verification)) return err(verification.error);

      const backupCodes = this.generateBackupCodes();
      const hashedBackupCodes = await Promise.all(backupCodes.map((code) => hashPassword(code)));
      const repo = this.repoFor(subject);
      // Read the account BEFORE the transaction so audit attribution needs no
      // in-transaction read (a transient attribution read must never roll back
      // an already-successful MFA mutation — see `audit()`).
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");

      await this.runInTransaction(async () => {
        const replaced = await repo.replaceBackupCodes(subject.id, hashedBackupCodes);
        if (isErr(replaced)) throw new Error("USER_NOT_FOUND");
        await this.audit(
          subject,
          "MFA_BACKUP_CODES_REGENERATED",
          "MEDIUM",
          undefined,
          found.value.accountId
        );
      });

      return ok(backupCodes);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Backup codes regeneration error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method disableMfa
   * @description Self-service disable: requires a valid current token, then clears
   *              all MFA state.
   * @param subject - The enrolled subject.
   * @param token - A valid TOTP or unused backup code.
   * @returns Ok(void) on success, or a typed verify error.
   */
  async disableMfa(subject: MfaSubject, token: string): Promise<Result<void, VerifyTokenError>> {
    try {
      const verification = await this.verifyMfaToken(subject, token);
      if (isErr(verification)) return err(verification.error);
      const repo = this.repoFor(subject);
      // Read the account BEFORE the transaction so audit attribution needs no
      // in-transaction read (a transient attribution read must never roll back
      // an already-successful MFA mutation — see `audit()`).
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");

      await this.runInTransaction(async () => {
        const cleared = await repo.clearMfa(subject.id);
        if (isErr(cleared)) throw new Error("USER_NOT_FOUND");
        await this.audit(subject, "MFA_DISABLED", "HIGH", undefined, found.value.accountId);
      });

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "MFA disable error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method adminForceDisable
   * @description Admin emergency recovery: disable a subject's MFA without a token
   *              (invoked under admin privilege). The acting admin is the audit
   *              ACTOR (`auditActor.admin(actor.id)`) — the subject is the resource
   *              being acted on, recorded in `details.subjectId`, never as the
   *              actor. Never logs any secret material.
   * @param subject - The subject whose MFA is being force-disabled.
   * @param actor - The admin performing the action (recorded in the audit trail).
   * @returns Ok({accountId}) on success — the affected account (the customer's
   *          tenant account, or the acting admin's id for an admin subject) so a
   *          caller's own audit row can be scoped to it — or a typed error.
   */
  async adminForceDisable(
    subject: MfaSubject,
    actor: MfaActor
  ): Promise<Result<{ accountId: string }, ForceDisableError>> {
    try {
      const repo = this.repoFor(subject);
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");

      // The audit accountId is the affected account for searchability: the
      // subject's own accountId for a customer, else the acting admin's id
      // (admin convention — AdminUser is global, no real account scope).
      const accountId =
        subject.type === MFA_SUBJECT_TYPE.CUSTOMER && found.value.accountId
          ? found.value.accountId
          : actor.id;

      await this.runInTransaction(async () => {
        const cleared = await repo.clearMfa(subject.id);
        if (isErr(cleared)) throw new Error("USER_NOT_FOUND");
        await this.audit(
          subject,
          "MFA_ADMIN_FORCE_DISABLED",
          "HIGH",
          { actorId: actor.id, subjectId: subject.id },
          undefined,
          { actor: auditActor.admin(actor.id), accountId }
        );
      });

      return ok({ accountId });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Admin force-disable MFA error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method getMfaStatus
   * @description Report whether MFA is enabled and how many backup codes remain
   *              unused. Never returns the secret or any code value.
   * @param subject - The subject to inspect.
   * @returns Ok({enabled,backupCodesCount}) or a typed status error.
   */
  async getMfaStatus(
    subject: MfaSubject
  ): Promise<Result<{ enabled: boolean; backupCodesCount: number }, StatusError>> {
    try {
      const repo = this.repoFor(subject);
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");
      const record = found.value;
      const usedCount = Object.keys(record.mfaBackupUsedAt).length;
      const backupCodesCount = Math.max(0, record.mfaBackupCodes.length - usedCount);
      return ok({ enabled: record.mfaEnabled, backupCodesCount });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get MFA status error");
      return err("DATABASE_ERROR");
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Select the adapter for a subject. Two-member closed dispatch. */
  private repoFor(subject: MfaSubject): MfaUserRepositoryPort {
    return subject.type === MFA_SUBJECT_TYPE.CUSTOMER ? this.customerRepo : this.adminRepo;
  }

  /** Generate the pinned set of 8×8-hex uppercase backup codes. */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.backupCodesCount; i++) {
      codes.push(crypto.randomBytes(BACKUP_CODE_BYTES).toString("hex").toUpperCase());
    }
    return codes;
  }

  /**
   * Verify a TOTP with the window pinned per call. `clone` yields a fresh
   * instance with merged options, leaving the shared `authenticator.options`
   * untouched. Malformed input verifies as `false` rather than throwing.
   */
  private verifyTotp(token: string, secret: string): boolean {
    try {
      return authenticator.clone({ window: TOTP_WINDOW }).verify({ token, secret });
    } catch {
      return false;
    }
  }

  /** Run a mutation inside the Unit of Work when one is injected. */
  private async runInTransaction(fn: () => Promise<void>): Promise<void> {
    if (this.unitOfWork) {
      await this.unitOfWork.executeInTransaction(fn);
    } else {
      await fn();
    }
  }

  /**
   * Write a SECURITY-category audit event for the subject. Details never carry
   * the TOTP secret or any backup-code value.
   *
   * Actor + account attribution is resolved in priority order:
   *   1. `actorOverride` — a caller-supplied actor DIFFERENT from the subject
   *      (used by `adminForceDisable`, where the acting admin, not the disabled
   *      subject, is the actor).
   *   2. `knownAccountId` for a CUSTOMER subject — the subject IS the actor and
   *      the caller already loaded the record, so its `accountId` is threaded in
   *      directly. This avoids a redundant, in-transaction attribution read: a
   *      transient failure of that pure-attribution read would otherwise roll
   *      back an already-successful MFA mutation.
   *   3. `resolveAuditActor(subject)` — the documented last-resort fallback for
   *      any future call site without the record at hand. Unreachable from the
   *      current live flows, which all thread `knownAccountId` for customers;
   *      admin subjects resolve here with no DB read.
   */
  private async audit(
    subject: MfaSubject,
    action: string,
    severity: "MEDIUM" | "HIGH",
    details?: Record<string, unknown>,
    knownAccountId?: string,
    actorOverride?: { actor: AuditActor; accountId: string }
  ): Promise<void> {
    const attribution =
      actorOverride ??
      (subject.type === MFA_SUBJECT_TYPE.CUSTOMER && knownAccountId !== undefined
        ? { actor: auditActor.customer(subject.id, knownAccountId), accountId: knownAccountId }
        : await this.resolveAuditActor(subject));
    await this.logSecurityEvent(attribution.actor, attribution.accountId, {
      action,
      severity,
      details: { subjectType: subject.type, ...(details ?? {}) },
    });
  }

  /**
   * Resolve the audit actor + accountId for a subject — the documented
   * last-resort attribution path for any future call site that lacks the
   * already-loaded record. Admin maps straight to `auditActor.admin` —
   * `AdminUser` is a global table, so the codebase convention (cf.
   * `authServiceCore.ts`) uses the admin's own id as the audit `accountId`.
   * Customer loads the record to read its real `accountId` and maps to
   * `auditActor.customer` so the row is attributed via `customerUserId`, never
   * `userId`.
   *
   * The live self-service flows never reach the CUSTOMER branch below: they all
   * thread the record's `accountId` into `audit()` as `knownAccountId`, so this
   * fallback read stays out of the write transaction.
   */
  private async resolveAuditActor(
    subject: MfaSubject
  ): Promise<{ actor: AuditActor; accountId: string }> {
    if (subject.type !== MFA_SUBJECT_TYPE.CUSTOMER) {
      return { actor: auditActor.admin(subject.id), accountId: subject.id };
    }
    const found = await this.customerRepo.findById(subject.id);
    // Last resort only: if the record vanished, self-scope the accountId to the
    // subject id rather than DROP the security event — a missing tenant scope
    // must never silently lose an audited MFA action. Live flows never hit this
    // (they pass knownAccountId), so this junk-scope path is unreachable there.
    const accountId = found.ok && found.value.accountId ? found.value.accountId : subject.id;
    return { actor: auditActor.customer(subject.id, accountId), accountId };
  }
}
