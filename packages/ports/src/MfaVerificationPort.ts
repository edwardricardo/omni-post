/**
 * @file MfaVerificationPort.ts
 * @description Technology-free port for login-time MFA verification. A `@core`
 *              use case (customer login step 2) depends only on this contract;
 *              the concrete verifier is the unified `MfaService` in apps/api,
 *              which `implements MfaVerificationPort`. The result shape and error
 *              union live here (not in the service) so the port is the single
 *              source of truth shared by both sides of the seam.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { MfaSubject } from "./MfaUserRepositoryPort.js";

/**
 * Outcome of a login-time MFA verification: whether it verified, and whether a
 * single-use backup code (rather than a TOTP) was consumed.
 */
export interface MfaVerificationResult {
  verified: boolean;
  usedBackupCode: boolean;
}

/** Failure modes when verifying a login-time MFA token. */
export type MfaVerifyTokenError =
  | "USER_NOT_FOUND"
  | "MFA_NOT_ENABLED"
  | "INVALID_TOKEN"
  | "DATABASE_ERROR";

/**
 * Port for verifying a TOTP or single-use backup code for a subject at login.
 * Never throws across the boundary — every failure is a typed `Result`.
 */
export interface MfaVerificationPort {
  /**
   * Verify a login-time MFA token (TOTP first, then unused backup codes) for
   * the given subject, enforcing TOTP single-use.
   *
   * @param subject - The admin or customer subject verifying.
   * @param token - A TOTP or a backup code.
   * @returns Ok({verified,usedBackupCode}) on success, or a typed verify error.
   */
  verifyMfaToken(
    subject: MfaSubject,
    token: string
  ): Promise<Result<MfaVerificationResult, MfaVerifyTokenError>>;
}
