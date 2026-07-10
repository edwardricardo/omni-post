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
import { AuditableService, auditActor } from "../../services/AuditableService.js";
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
   *              plaintext codes are returned exactly once.
   * @param subject - The admin or customer subject to enroll.
   * @param email - Label used for the TOTP key URI / QR code.
   * @returns Ok(setup) with the plaintext codes, or a typed setup error.
   */
  async setupMfa(subject: MfaSubject, email: string): Promise<Result<MfaSetupData, SetupError>> {
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

      const otpauthUrl = authenticator.keyuri(email, this.issuer, secret);
      const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

      await this.audit(subject, "MFA_SETUP_INITIATED", "MEDIUM");

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
        await this.audit(subject, "MFA_SETUP_FAILED", "MEDIUM", { reason: "INVALID_TOKEN" });
        return err("INVALID_TOKEN");
      }

      await this.runInTransaction(async () => {
        const enabled = await repo.setMfaEnabled(subject.id, true);
        if (isErr(enabled)) throw new Error("USER_NOT_FOUND");
        await this.audit(subject, "MFA_ENABLED", "HIGH");
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
            await this.audit(subject, "MFA_BACKUP_CODE_USED", "MEDIUM", {
              remainingCodes: remaining,
            });
          });
          return ok({ verified: true, usedBackupCode: true });
        }
      }

      await this.audit(subject, "MFA_VERIFICATION_FAILED", "MEDIUM", { tokenLength: token.length });
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

      await this.runInTransaction(async () => {
        const replaced = await repo.replaceBackupCodes(subject.id, hashedBackupCodes);
        if (isErr(replaced)) throw new Error("USER_NOT_FOUND");
        await this.audit(subject, "MFA_BACKUP_CODES_REGENERATED", "MEDIUM");
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

      await this.runInTransaction(async () => {
        const cleared = await repo.clearMfa(subject.id);
        if (isErr(cleared)) throw new Error("USER_NOT_FOUND");
        await this.audit(subject, "MFA_DISABLED", "HIGH");
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
   *              (invoked under admin privilege). Audits actor + subject, never any
   *              secret material.
   * @param subject - The subject whose MFA is being force-disabled.
   * @param actor - The admin performing the action (recorded in the audit trail).
   * @returns Ok(void) on success, or a typed force-disable error.
   */
  async adminForceDisable(
    subject: MfaSubject,
    actor: MfaActor
  ): Promise<Result<void, ForceDisableError>> {
    try {
      const repo = this.repoFor(subject);
      const found = await repo.findById(subject.id);
      if (isErr(found)) return err("USER_NOT_FOUND");

      await this.runInTransaction(async () => {
        const cleared = await repo.clearMfa(subject.id);
        if (isErr(cleared)) throw new Error("USER_NOT_FOUND");
        await this.audit(subject, "MFA_ADMIN_FORCE_DISABLED", "HIGH", {
          actorId: actor.id,
          subjectId: subject.id,
        });
      });

      return ok(undefined);
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
   */
  private async audit(
    subject: MfaSubject,
    action: string,
    severity: "MEDIUM" | "HIGH",
    details?: Record<string, unknown>
  ): Promise<void> {
    // Behavior-preserving: every live subject is admin until mfa-consolidation
    // PR2 repoints customer subjects onto auditActor.customer(subject.id,
    // accountId). This is the MFA PR2 handoff seam.
    await this.logSecurityEvent(auditActor.admin(subject.id), subject.id, {
      action,
      severity,
      details: { subjectType: subject.type, ...(details ?? {}) },
    });
  }
}
