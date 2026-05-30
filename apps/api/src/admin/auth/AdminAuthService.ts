/**
 * @file AdminAuthService.ts
 * @description Orchestrates all admin authentication operations by coordinating
 *              PasswordService, TokenService, SessionManager, MfaService, and the
 *              canon-aligned BruteForceProtectionPort (NIST SP 800-63B-4 + OWASP).
 * @layer infrastructure
 * This service provides the main public API for authentication operations
 * while delegating specific concerns to specialized services.
 */

import type { PrismaClient } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import type { BruteForceProtectionPort } from "@ports/core";
import type {
  AdminUserProfile,
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  DeviceFingerprint,
  SecurityEvent,
  AuthErrorCode,
  MfaSetupResponse,
  MfaStatusResponse,
  SessionInfo,
  PasswordValidation,
} from "./adminAuthTypes";
import { PasswordService } from "./PasswordService";
import { TokenService } from "./TokenService";
import { SessionManager } from "./SessionManager";
import { MfaService } from "./MfaService";
import { hashRefreshToken } from "../../auth/refreshTokenHash.js";

export class AdminAuthService {
  private passwordService: PasswordService;
  private tokenService: TokenService;
  private sessionManager: SessionManager;
  private mfaService: MfaService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly bruteForce: BruteForceProtectionPort
  ) {
    this.passwordService = new PasswordService(this.prisma);
    this.tokenService = new TokenService();
    this.sessionManager = new SessionManager(this.prisma, this.tokenService);
    this.mfaService = new MfaService(this.prisma);
  }

  // ==========================================================================
  // Core Authentication Methods
  // ==========================================================================

  /**
   * Login admin user
   */
  async login(
    request: LoginRequest,
    device: DeviceFingerprint
  ): Promise<Result<LoginResponse, AuthErrorCode>> {
    const { email, password, mfaToken, rememberMe = false } = request;
    const ip = device.ipAddress ?? "0.0.0.0";
    const userAgent = device.userAgent ?? "";

    // Brute-force gate (NIST SP 800-63B-4 §rate-limiting + OWASP Auth Cheat Sheet).
    // Account-based primary — IP rotation does not bypass this counter.
    const check = await this.bruteForce.checkLoginAttempt({
      identifier: email,
      ip,
      userAgent,
    });
    if (!check.allowed) {
      if (check.reason === "account_lockout") return err("ACCOUNT_LOCKED");
      return err("RATE_LIMIT_EXCEEDED");
    }
    if (check.delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, check.delaySeconds * 1000));
    }

    // Find user (include role relation for profile mapping)
    const user = await this.prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    });

    if (!user) {
      await this.bruteForce.recordFailedAttempt({
        identifier: email,
        ip,
        userAgent,
        failureReason: "USER_NOT_FOUND",
      });
      return err("INVALID_CREDENTIALS");
    }

    // Admin manual lock (independent of BF gate — admin UI can lock a user
    // outside the rate-limit flow; keep this check to honor that decision).
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return err("ACCOUNT_LOCKED");
    }

    // Check if account is active
    if (!user.isActive) {
      await this.bruteForce.recordFailedAttempt({
        identifier: email,
        ip,
        userAgent,
        failureReason: "ACCOUNT_INACTIVE",
      });
      return err("ACCOUNT_INACTIVE");
    }

    // Verify password
    const { valid } = await this.passwordService.verifyPassword(password, user.passwordHash);

    if (!valid) {
      await this.bruteForce.recordFailedAttempt({
        identifier: email,
        ip,
        userAgent,
        failureReason: "INVALID_PASSWORD",
      });
      return err("INVALID_CREDENTIALS");
    }

    // Check MFA
    if (user.mfaEnabled) {
      if (!mfaToken) {
        return err("MFA_REQUIRED");
      }

      const mfaValid = await this.mfaService.verifyMfaToken(user.id, mfaToken);
      if (!mfaValid) {
        await this.bruteForce.recordFailedAttempt({
          identifier: email,
          ip,
          userAgent,
          failureReason: "MFA_INVALID",
        });
        return err("MFA_INVALID");
      }
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
    await this.bruteForce.recordSuccessfulAttempt({
      identifier: email,
      ip,
      userAgent,
    });

    // Log security event - build event object conditionally
    const securityEvent: SecurityEvent = {
      type: "LOGIN_SUCCESS",
      userId: user.id,
      email: user.email,
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      deviceId: device.deviceId,
      success: true,
      timestamp: new Date(),
    };

    if (device.location) {
      securityEvent.location = device.location;
    }

    await this.logSecurityEvent(securityEvent);

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
   * Refresh access token using refresh token
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
   * Logout admin user
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
   * Verify and decode access token
   * Public method for middleware usage
   */
  public verifyAccessToken(
    token: string
  ): Result<import("./adminAuthTypes").AccessTokenPayload, AuthErrorCode> {
    return this.tokenService.verifyAccessToken(token);
  }

  // ==========================================================================
  // Password Management Methods
  // ==========================================================================

  /**
   * Validate password strength
   */
  public validatePassword(password: string): PasswordValidation {
    return this.passwordService.validatePassword(password);
  }

  /**
   * Change password for authenticated user
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
   * Initiate password reset (forgot password flow)
   * Generates reset token and stores it in database
   */
  public async initiatePasswordReset(email: string): Promise<Result<string, AuthErrorCode>> {
    return this.passwordService.initiatePasswordReset(email, this.logSecurityEvent.bind(this));
  }

  /**
   * Confirm password reset with token
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
   * Update the authenticated admin's own profile. Only the provided fields are
   * written; returns the list of updated keys. Callers validate non-empty input.
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
   * Resolve an admin's display name + email for transactional emails (e.g. the
   * password-reset notification). Returns null when no admin matches.
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
   * Setup MFA for admin user (generates secret and QR code)
   */
  public async setupMfa(userId: string): Promise<Result<MfaSetupResponse, AuthErrorCode>> {
    return this.mfaService.setupMfa(userId);
  }

  /**
   * Verify MFA token and enable MFA
   */
  public async verifyAndEnableMfa(
    userId: string,
    token: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    return this.mfaService.verifyAndEnableMfa(userId, token, this.logSecurityEvent.bind(this));
  }

  /**
   * Disable MFA for a user
   */
  public async disableMfa(
    userId: string,
    password: string,
    mfaToken: string
  ): Promise<Result<boolean, AuthErrorCode>> {
    return this.mfaService.disableMfa(
      userId,
      password,
      mfaToken,
      this.passwordService.verifyPassword.bind(this.passwordService),
      this.logSecurityEvent.bind(this)
    );
  }

  /**
   * Get MFA status for a user
   */
  public async getMfaStatus(userId: string): Promise<Result<MfaStatusResponse, AuthErrorCode>> {
    return this.mfaService.getMfaStatus(userId);
  }

  // ==========================================================================
  // Session Management Methods
  // ==========================================================================

  /**
   * List active sessions for a user
   */
  public async listSessions(userId: string): Promise<Result<SessionInfo[], AuthErrorCode>> {
    return this.sessionManager.listSessions(userId);
  }

  /**
   * Revoke a specific session
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
