/**
 * @file AdminAuthService.ts
 * @description Orchestrates all admin authentication operations by coordinating
 *              PasswordService, TokenService, SessionManager, MfaService, and the
 *              canon-aligned BruteForceProtectionPort (NIST SP 800-63B-4 + OWASP).
 * @layer infrastructure
 * This service provides the main public API for authentication operations
 * while delegating specific concerns to specialized services.
 */

import type { AdminUser, PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import {
  MFA_SUBJECT_TYPE,
  type BruteForceProtectionPort,
  type CheckLoginAttemptInput,
} from "@ports/core";
import { deriveActorType } from "@core/domain/repositories/AuditLogRepository.js";
import type {
  AdminUserProfile,
  LoginRequest,
  LoginResponse,
  RequiredPasswordChangeRequest,
  RefreshTokenRequest,
  RefreshTokenResponse,
  DeviceFingerprint,
  SecurityEvent,
  AuthErrorCode,
  MfaSetupResponse,
  MfaStatusResponse,
  SessionInfo,
  PasswordValidation,
} from "./adminAuthTypes.js";
import { PasswordService } from "./PasswordService.js";
import { TokenService } from "./TokenService.js";
import { SessionManager } from "./SessionManager.js";
import { MfaService } from "./MfaService.js";
import { hashRefreshToken } from "../../auth/refreshTokenHash.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";

/** The credentials the sign-in's checks verify. */
type SignInCredentials = Pick<LoginRequest, "email" | "password" | "mfaToken">;

/** The attempt the brute-force port counts: the e-mail as presented, the address, the agent. */
function attemptOf(email: string, device: DeviceFingerprint): CheckLoginAttemptInput {
  return {
    identifier: email,
    ip: device.ipAddress ?? "0.0.0.0",
    userAgent: device.userAgent ?? "",
  };
}

export class AdminAuthService {
  private passwordService: PasswordService;
  private tokenService: TokenService;
  private sessionManager: SessionManager;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly bruteForce: BruteForceProtectionPort,
    private readonly mfaService: MfaService
  ) {
    this.passwordService = new PasswordService(this.prisma);
    this.tokenService = new TokenService();
    this.sessionManager = new SessionManager(this.prisma, this.tokenService);
  }

  // ==========================================================================
  // Core Authentication Methods
  // ==========================================================================

  /**
   * @method login
   * @description Signs an administrator in: runs the sign-in's checks, then opens a session,
   *   writes `lastLoginAt`, clears the brute-force counters and records the sign-in.
   *
   *   An administrator whose password must be changed is refused once every check has passed,
   *   before anything is written: no session, no token, no `lastLoginAt`, no session cleanup or
   *   cap, no cleared counters and no recorded sign-in. The credentials were right, so no failed
   *   attempt is recorded either. The refusal comes after the second factor, so a caller who
   *   holds the password but not the second factor learns nothing of the mark, and the code
   *   that verified is spent by the refused sign-in.
   * @param request - The e-mail, the password, the second factor's code when there is one, and
   *   whether the session is remembered
   * @param device - The caller's device, whose address and agent the session and the attempt
   *   records carry
   * @returns The administrator's profile and the session's tokens; otherwise the code of the
   *   check that failed, `PASSWORD_CHANGE_REQUIRED` for a password that must be changed, or
   *   `INTERNAL_ERROR` when the profile cannot be read back
   */
  async login(
    request: LoginRequest,
    device: DeviceFingerprint
  ): Promise<Result<LoginResponse, AuthErrorCode>> {
    const { rememberMe = false } = request;
    const attempt = attemptOf(request.email, device);

    const verified = await this.verifySignIn(request, attempt);
    if (!verified.ok) {
      return err(verified.error);
    }
    const user = verified.value;

    if (user.mustChangePassword) {
      return err("PASSWORD_CHANGE_REQUIRED");
    }

    // Cleanup expired sessions
    await this.sessionManager.cleanupExpiredSessions(user.id);

    // Enforce max concurrent sessions
    await this.sessionManager.enforceMaxSessions(user.id, user.maxConcurrentSessions);

    // Create session
    const { tokens } = await this.sessionManager.createSession(
      user.id,
      device,
      rememberMe,
      this.getUserProfile.bind(this)
    );

    // Update last login
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Successful authentication — clear per-identifier counters.
    await this.bruteForce.recordSuccessfulAttempt(attempt);

    await this.logSecurityEvent(this.successEventOf("LOGIN_SUCCESS", user, device));

    const profile = await this.getUserProfile(user.id);
    if (!profile.ok) {
      return err("INTERNAL_ERROR");
    }

    return ok({
      user: profile.value,
      tokens,
      requiresMfa: false,
    });
  }

  /**
   * @method changeRequiredPassword
   * @description Replaces the password of an administrator who must change it, for a caller who
   *   holds no session. It runs the sign-in's checks on the e-mail and the current password,
   *   refuses an administrator whose password is not marked to be changed, and replaces the
   *   password and clears the mark in one guarded write. It opens no session, issues no token,
   *   leaves `lastLoginAt` as it is and revokes every session of the administrator, so the
   *   administrator then signs in with the new password.
   *
   *   The policy, which needs no secret and no row, is checked first, so a password it refuses
   *   spends no second-factor code. The refusals that need the row (not marked, reused, the
   *   current password, the guarded write) come after the second factor, so a caller who holds
   *   the password but not the second factor learns neither whether the administrator is marked
   *   nor anything of the password history.
   * @param request - The e-mail, the current password, the new password, and the second
   *   factor's code when the administrator has one
   * @param device - The caller's device, whose address and agent the attempt records and the
   *   security event carry
   * @returns `ok` once the password is replaced; otherwise `PASSWORD_TOO_WEAK`, the code of the
   *   sign-in check that failed, `PASSWORD_CHANGE_NOT_REQUIRED`, `PASSWORD_REUSED` or
   *   `CONCURRENT_MODIFICATION`
   */
  public async changeRequiredPassword(
    request: RequiredPasswordChangeRequest,
    device: DeviceFingerprint
  ): Promise<Result<void, AuthErrorCode>> {
    if (!this.passwordService.validatePassword(request.newPassword).valid) {
      return err("PASSWORD_TOO_WEAK");
    }

    const attempt = attemptOf(request.email, device);
    const verified = await this.verifySignIn(
      {
        email: request.email,
        password: request.currentPassword,
        ...(request.mfaToken !== undefined && { mfaToken: request.mfaToken }),
      },
      attempt
    );
    if (!verified.ok) {
      return err(verified.error);
    }

    const admin = verified.value;
    // The credentials were right, so this refusal records no failed attempt.
    if (!admin.mustChangePassword) {
      return err("PASSWORD_CHANGE_NOT_REQUIRED");
    }

    const replaced = await this.passwordService.replaceRequiredPassword(admin, request.newPassword);
    if (!replaced.ok) {
      return replaced;
    }

    await this.logSecurityEvent(this.successEventOf("PASSWORD_CHANGED", admin, device));

    await this.bruteForce.recordSuccessfulAttempt(attempt);
    return ok(undefined);
  }

  /**
   * The security event of an operation an administrator completed from a device: who, from
   * which address, agent and device, and where, when the device's location is known.
   */
  private successEventOf(
    type: SecurityEvent["type"],
    admin: Pick<AdminUser, "id" | "email">,
    device: DeviceFingerprint
  ): SecurityEvent {
    const event: SecurityEvent = {
      type,
      userId: admin.id,
      email: admin.email,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      deviceId: device.deviceId,
      success: true,
      timestamp: new Date(),
    };
    if (device.location) {
      event.location = device.location;
    }
    return event;
  }

  /**
   * The sign-in's checks, in order: the brute-force gate and the delay it asks for, the lookup by
   * normalized e-mail, the manual lock, the active check, the password and the second factor.
   * Every failure but the manual lock and a missing second factor is recorded as a failed
   * attempt. Nothing is written to the administrator's row.
   */
  private async verifySignIn(
    credentials: SignInCredentials,
    attempt: CheckLoginAttemptInput
  ): Promise<Result<AdminUser, AuthErrorCode>> {
    const { email, password, mfaToken } = credentials;

    // Brute-force gate (NIST SP 800-63B-4 §rate-limiting + OWASP Auth Cheat Sheet).
    // Account-based primary — IP rotation does not bypass this counter.
    const check = await this.bruteForce.checkLoginAttempt(attempt);
    if (!check.allowed) {
      if (check.reason === "account_lockout") return err("ACCOUNT_LOCKED");
      return err("RATE_LIMIT_EXCEEDED");
    }
    if (check.delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, check.delaySeconds * 1000));
    }

    // Find user (include role relation for profile mapping)
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalizeEmail(email) },
      include: { role: true },
    });

    if (!user) {
      await this.bruteForce.recordFailedAttempt({ ...attempt, failureReason: "USER_NOT_FOUND" });
      return err("INVALID_CREDENTIALS");
    }

    // Admin manual lock (independent of BF gate — admin UI can lock a user
    // outside the rate-limit flow; keep this check to honor that decision).
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return err("ACCOUNT_LOCKED");
    }

    // Check if account is active
    if (!user.isActive) {
      await this.bruteForce.recordFailedAttempt({ ...attempt, failureReason: "ACCOUNT_INACTIVE" });
      return err("ACCOUNT_INACTIVE");
    }

    // Verify password
    const { valid } = await this.passwordService.verifyPassword(password, user.passwordHash);

    if (!valid) {
      await this.bruteForce.recordFailedAttempt({ ...attempt, failureReason: "INVALID_PASSWORD" });
      return err("INVALID_CREDENTIALS");
    }

    // Check MFA
    if (user.mfaEnabled) {
      if (!mfaToken) {
        return err("MFA_REQUIRED");
      }

      const mfaResult = await this.mfaService.verifyMfaToken(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: user.id },
        mfaToken
      );
      if (!mfaResult.ok) {
        await this.bruteForce.recordFailedAttempt({ ...attempt, failureReason: "MFA_INVALID" });
        return err("MFA_INVALID");
      }
    }

    return ok(user);
  }

  /**
   * @method refreshToken
   * @description Issues a new access token for an active, unexpired session whose CSRF token and
   *   stored refresh-token hash match the ones presented. The refresh token is not rotated.
   * @param request - The refresh token and the session's CSRF token
   * @returns The new access token with the same refresh token, and the administrator's profile;
   *   otherwise `SESSION_EXPIRED`, `CSRF_TOKEN_MISMATCH`, `INVALID_TOKEN`, a token verification
   *   code, or `INTERNAL_ERROR` when the profile cannot be read
   */
  async refreshToken(
    request: RefreshTokenRequest
  ): Promise<Result<RefreshTokenResponse, AuthErrorCode>> {
    const { refreshToken, csrfToken } = request;

    // Verify refresh token
    const tokenResult = this.tokenService.verifyRefreshToken(refreshToken);
    if (!tokenResult.ok) {
      return err(tokenResult.error);
    }

    const payload = tokenResult.value;

    // Find session
    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session || !session.isActive || session.expiresAt < new Date()) {
      return err("SESSION_EXPIRED");
    }

    // Verify CSRF token
    if (session.csrfToken !== csrfToken) {
      return err("CSRF_TOKEN_MISMATCH");
    }

    // Verify refresh token matches the stored hash. We compare digests
    // (not raw tokens) so a DB exfiltration leaks only hashes, not bearer
    // tokens that could be replayed against the API.
    if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
      return err("INVALID_TOKEN");
    }

    // Generate new access token (reads session timeout from SecuritySettings)
    const profile = await this.getUserProfile(session.userId);
    if (!profile.ok) {
      return err("INTERNAL_ERROR");
    }

    const securitySettings = await this.prisma.securitySettings.findFirst({
      select: { sessionTimeoutMinutes: true },
    });
    const sessionTimeoutMinutes = securitySettings?.sessionTimeoutMinutes ?? 15;

    const accessToken = this.tokenService.generateAccessToken(
      profile.value,
      session.deviceId || undefined,
      sessionTimeoutMinutes
    );

    // Update session last activity
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    });

    return ok({
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 15 * 60,
        csrfToken: session.csrfToken,
      },
      user: profile.value,
    });
  }

  /**
   * @method logout
   * @description Revokes every active session of the administrator, or the one named, and
   *   records the sign-out.
   * @param userId - The administrator signing out
   * @param sessionId - The session to revoke when not revoking all of them
   * @param allSessions - Whether every active session is revoked
   * @returns `ok(true)` once the sessions are revoked and the event recorded
   */
  async logout(
    userId: string,
    sessionId?: string,
    allSessions = false
  ): Promise<Result<boolean, AuthErrorCode>> {
    if (allSessions) {
      // Revoke all sessions
      await this.prisma.adminSession.updateMany({
        where: {
          userId,
          isActive: true,
        },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokeReason: "USER_LOGOUT",
        },
      });
    } else if (sessionId) {
      // Revoke specific session
      await this.prisma.adminSession.update({
        where: { id: sessionId },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokeReason: "USER_LOGOUT",
        },
      });
    }

    await this.logSecurityEvent({
      type: "LOGOUT",
      userId,
      success: true,
      timestamp: new Date(),
    });

    return ok(true);
  }

  // ==========================================================================
  // Token Management (Public API)
  // ==========================================================================

  /**
   * @method verifyAccessToken
   * @description Verifies and decodes an administrator's access token, for the authentication
   *   middleware.
   * @param token - The bearer access token
   * @returns The token's payload; otherwise `TOKEN_EXPIRED` or `INVALID_TOKEN`
   */
  public verifyAccessToken(
    token: string
  ): Result<import("./adminAuthTypes.js").AccessTokenPayload, AuthErrorCode> {
    return this.tokenService.verifyAccessToken(token);
  }

  // ==========================================================================
  // Password Management Methods
  // ==========================================================================

  /**
   * @method validatePassword
   * @description Scores a password against the administrators' password policy.
   * @param password - The password to score
   * @returns Whether the policy accepts it, its strength, and the errors and suggestions
   */
  public validatePassword(password: string): PasswordValidation {
    return this.passwordService.validatePassword(password);
  }

  /**
   * @method changePassword
   * @description Changes the password of a signed-in administrator who presents the current one,
   *   and revokes every session of that administrator.
   * @param userId - The signed-in administrator
   * @param currentPassword - The password the administrator signed in with
   * @param newPassword - The replacement, checked against the policy and the recent passwords
   * @returns `ok(true)` once changed; otherwise `USER_NOT_FOUND`, `INVALID_CREDENTIALS`,
   *   `PASSWORD_TOO_WEAK` or `PASSWORD_REUSED`
   */
  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    return this.passwordService.changePassword(
      userId,
      currentPassword,
      newPassword,
      this.logSecurityEvent.bind(this)
    );
  }

  /**
   * @method initiatePasswordReset
   * @description Starts the forgotten-password flow: stores a reset token valid for one hour on
   *   an active administrator with that e-mail. An unknown or inactive e-mail gets a stand-in
   *   value, so the answer does not say whether the address exists.
   * @param email - The address the reset was requested for
   * @returns The reset token the caller e-mails, or the stand-in value
   */
  public async initiatePasswordReset(email: string): Promise<Result<string, AuthErrorCode>> {
    return this.passwordService.initiatePasswordReset(email, this.logSecurityEvent.bind(this));
  }

  /**
   * @method confirmPasswordReset
   * @description Completes a password reset by claiming the reset token; at most one caller
   *   consumes a token.
   * @param token - The reset token presented
   * @param newPassword - The replacement, checked against the policy and the recent passwords
   * @returns `ok(true)` for the caller that consumed the token; otherwise `INVALID_TOKEN`,
   *   `PASSWORD_TOO_WEAK`, `PASSWORD_REUSED`, `CONCURRENT_MODIFICATION` or `INTERNAL_ERROR`
   */
  public async confirmPasswordReset(
    token: string,
    newPassword: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    return this.passwordService.confirmPasswordReset(
      token,
      newPassword,
      this.logSecurityEvent.bind(this)
    );
  }

  // ==========================================================================
  // Profile
  // ==========================================================================

  /**
   * @method updateProfile
   * @description Updates the signed-in administrator's own profile. Only the provided fields are
   *   written; callers validate that at least one is provided.
   * @param userId - The signed-in administrator
   * @param data - The time zone, locale or avatar URL to write
   * @returns The keys that were written
   */
  public async updateProfile(
    userId: string,
    data: { timezone?: string; locale?: string; avatarUrl?: string }
  ): Promise<{ updated: string[] }> {
    const patch: Record<string, string> = {};
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.locale !== undefined) patch.locale = data.locale;
    if (data.avatarUrl !== undefined) patch.avatarUrl = data.avatarUrl;

    await this.prisma.adminUser.update({ where: { id: userId }, data: patch });
    return { updated: Object.keys(patch) };
  }

  /**
   * @method findAdminContactByEmail
   * @description Reads an administrator's display name and e-mail for a transactional e-mail,
   *   such as the password-reset notification.
   * @param email - The stored address to look up
   * @returns The name and e-mail, or null when no administrator has that address
   */
  public async findAdminContactByEmail(
    email: string
  ): Promise<{ name: string; email: string } | null> {
    return this.prisma.adminUser.findUnique({
      where: { email },
      select: { name: true, email: true },
    });
  }

  // ==========================================================================
  // MFA Methods
  // ==========================================================================

  /**
   * @method setupMfa
   * @description Starts the second factor's enrolment: generates the secret, its QR code and
   *   the backup codes.
   * @param userId - The signed-in administrator
   * @returns The secret, the QR code and the backup codes; otherwise `USER_NOT_FOUND`,
   *   `INVALID_REQUEST` when a second factor is already enabled, or `INTERNAL_ERROR`
   */
  public async setupMfa(userId: string): Promise<Result<MfaSetupResponse, AuthErrorCode>> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return err("USER_NOT_FOUND");
    }
    const result = await this.mfaService.setupMfa({ type: MFA_SUBJECT_TYPE.ADMIN, id: userId });
    if (!result.ok) {
      if (result.error === "USER_NOT_FOUND") return err("USER_NOT_FOUND");
      if (result.error === "MFA_ALREADY_ENABLED") return err("INVALID_REQUEST");
      return err("INTERNAL_ERROR");
    }
    return ok({
      secret: result.value.secret,
      qrCodeUrl: result.value.qrCodeUrl,
      backupCodes: result.value.backupCodes,
      recoveryCodes: result.value.backupCodes,
    });
  }

  /**
   * @method verifyAndEnableMfa
   * @description Enables the second factor once a code from the enrolled secret verifies.
   * @param userId - The signed-in administrator
   * @param token - A code from the enrolled secret
   * @returns `ok(true)` once enabled; otherwise `MFA_INVALID`, `USER_NOT_FOUND` or
   *   `INVALID_REQUEST`
   */
  public async verifyAndEnableMfa(
    userId: string,
    token: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    const result = await this.mfaService.verifyMfaSetup(
      { type: MFA_SUBJECT_TYPE.ADMIN, id: userId },
      token
    );
    if (!result.ok) {
      switch (result.error) {
        case "INVALID_TOKEN":
          return err("MFA_INVALID");
        case "USER_NOT_FOUND":
          return err("USER_NOT_FOUND");
        default:
          return err("INVALID_REQUEST");
      }
    }
    return ok(true);
  }

  /**
   * @method disableMfa
   * @description Disables the second factor after the password and a code verify. The password
   *   re-check is this service's concern; the code check and the clearing of the second
   *   factor's state belong to the MFA service.
   * @param userId - The signed-in administrator
   * @param password - The administrator's password
   * @param mfaToken - A code from the enrolled secret
   * @returns `ok(true)` once disabled; otherwise `USER_NOT_FOUND`, `INVALID_REQUEST`,
   *   `INVALID_CREDENTIALS`, `MFA_INVALID` or `INTERNAL_ERROR`
   */
  public async disableMfa(
    userId: string,
    password: string,
    mfaToken: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: { passwordHash: true, mfaEnabled: true },
    });
    if (!user) {
      return err("USER_NOT_FOUND");
    }
    if (!user.mfaEnabled) {
      return err("INVALID_REQUEST");
    }
    const { valid } = await this.passwordService.verifyPassword(password, user.passwordHash);
    if (!valid) {
      return err("INVALID_CREDENTIALS");
    }
    const result = await this.mfaService.disableMfa(
      { type: MFA_SUBJECT_TYPE.ADMIN, id: userId },
      mfaToken
    );
    if (!result.ok) {
      switch (result.error) {
        case "INVALID_TOKEN":
          return err("MFA_INVALID");
        case "MFA_NOT_ENABLED":
          return err("INVALID_REQUEST");
        case "USER_NOT_FOUND":
          return err("USER_NOT_FOUND");
        default:
          return err("INTERNAL_ERROR");
      }
    }
    return ok(true);
  }

  /**
   * @method getMfaStatus
   * @description Reads whether the second factor is enabled and how many backup codes remain.
   * @param userId - The signed-in administrator
   * @returns The status; otherwise `USER_NOT_FOUND` or `INTERNAL_ERROR`
   */
  public async getMfaStatus(userId: string): Promise<Result<MfaStatusResponse, AuthErrorCode>> {
    const result = await this.mfaService.getMfaStatus({ type: MFA_SUBJECT_TYPE.ADMIN, id: userId });
    if (!result.ok) {
      return err(result.error === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "INTERNAL_ERROR");
    }
    return ok({
      enabled: result.value.enabled,
      backupCodesRemaining: result.value.backupCodesCount,
    });
  }

  // ==========================================================================
  // Session Management Methods
  // ==========================================================================

  /**
   * @method listSessions
   * @description Lists the administrator's active sessions.
   * @param userId - The signed-in administrator
   * @returns The active sessions
   */
  public async listSessions(userId: string): Promise<Result<SessionInfo[], AuthErrorCode>> {
    return this.sessionManager.listSessions(userId);
  }

  /**
   * @method revokeSession
   * @description Revokes one session of the administrator and records the revocation.
   * @param userId - The signed-in administrator
   * @param sessionId - The session to revoke
   * @param reason - Why the session is revoked
   * @returns `ok(true)` once revoked; otherwise the session manager's code
   */
  public async revokeSession(
    userId: string,
    sessionId: string,
    reason?: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    return this.sessionManager.revokeSession(
      userId,
      sessionId,
      reason,
      this.logSecurityEvent.bind(this)
    );
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Get admin user profile
   */
  private async getUserProfile(userId: string): Promise<Result<AdminUserProfile, AuthErrorCode>> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: { select: { name: true } },
        isActive: true,
        emailVerified: true,
        mfaEnabled: true,
        timezone: true,
        locale: true,
        department: true,
        team: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return err("USER_NOT_FOUND");
    }

    // Map role relation to role name string for the profile
    return ok({ ...user, role: user.role.name });
  }

  /**
   * Log security event to audit log
   */
  private async logSecurityEvent(event: SecurityEvent): Promise<void> {
    // Build audit log data object conditionally
    const auditData: Record<string, unknown> = {
      action: event.type,
      resource: "AdminAuth",
      success: event.success,
    };

    if (event.userId) {
      auditData.userId = event.userId;
    }
    // Explicit actor discriminator (this direct writer bypasses the
    // compiler-forcing port input). userId is set only for identified admins;
    // an unidentified security event (e.g. a login attempt for an unknown user)
    // has no FK, so it is SYSTEM — the canonical helper keeps the
    // reconciliation invariant "actorType='ADMIN' AND userId IS NULL -> 0"
    // intact and follows any future derivation-policy change automatically.
    auditData.actorType = deriveActorType({ ...(event.userId && { userId: event.userId }) });
    if (event.details) {
      auditData.details = event.details;
    }
    if (event.ipAddress) {
      auditData.ipAddress = event.ipAddress;
    }
    if (event.userAgent) {
      auditData.userAgent = event.userAgent;
    }
    if (event.error) {
      auditData.error = event.error;
    }

    await this.prisma.auditLog.create({
      data: auditData as Parameters<typeof this.prisma.auditLog.create>[0]["data"],
    });
  }
}
