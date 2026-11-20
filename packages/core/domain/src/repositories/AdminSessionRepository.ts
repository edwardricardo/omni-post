/**
 * @file AdminSessionRepository.ts
 * @description Repository port for admin session persistence — create, refresh-token
 *              rotation, per-user listing, and bulk revocation. DTO mirrors the
 *              persisted AdminSession row field-for-field.
 * @layer domain
 */

import type { JsonValue } from "./ReadModelDtos.js";

/**
 * Why code ended an administrator's session, as each ended session stores it in `revokeReason`:
 * the operation's name in upper snake case. The vocabulary is closed, so one operation always
 * stores one name.
 */
export const ADMIN_SESSION_REVOKE_REASONS = {
  /** The administrator changed the password, as required or by choice. */
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  /** A password reset was completed. */
  PASSWORD_RESET: "PASSWORD_RESET",
  /** The operator command re-issued the single-use password. */
  PASSWORD_REISSUED: "PASSWORD_REISSUED",
  /** Another administrator ended every session of the account. */
  ADMIN_REVOKED: "ADMIN_REVOKED",
  /** The account was suspended. */
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  /** The administrator signed out. */
  USER_LOGOUT: "USER_LOGOUT",
  /** The administrator ended one of its own sessions without giving a reason. */
  USER_REVOKED: "USER_REVOKED",
  /** The session expired or went inactive for too long. */
  SESSION_EXPIRED: "SESSION_EXPIRED",
  /** A new session pushed the administrator over its limit of concurrent sessions. */
  MAX_SESSIONS_EXCEEDED: "MAX_SESSIONS_EXCEEDED",
} as const;

/** One reason of `ADMIN_SESSION_REVOKE_REASONS`. */
export type AdminSessionRevokeReason =
  (typeof ADMIN_SESSION_REVOKE_REASONS)[keyof typeof ADMIN_SESSION_REVOKE_REASONS];

/**
 * Flat DTO for a persisted AdminSession row.
 * Mirrors the Prisma `AdminSession` model without the Prisma import. `revokeReason` stays a
 * string: besides the reasons of `ADMIN_SESSION_REVOKE_REASONS`, an administrator who ends one
 * of its own sessions may give a reason of its own, and it is stored as given.
 */
export interface AdminSessionDto {
  id: string;
  userId: string;
  refreshTokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  isActive: boolean;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  csrfToken: string;
  deviceId: string | null;
  deviceName: string | null;
  location: JsonValue | null;
  lastActivityAt: Date;
  revokedBy: string | null;
  revokeReason: string | null;
}

/**
 * Fields required to create a new admin session.
 * `ipAddress` and `userAgent` are optional; omit to store null.
 */
export interface AdminSessionCreateInput {
  userId: string;
  refreshTokenHash: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
}

/**
 * Options for listing a user's sessions.
 */
export interface AdminSessionFindOptions {
  activeOnly?: boolean;
  limit?: number;
}

/**
 * Port interface for admin session persistence.
 *
 * Consumers receive this interface via constructor injection —
 * they never import a concrete Prisma implementation directly.
 */
export interface AdminSessionRepository {
  /**
   * Persist a new session.
   *
   * @param input - Session fields
   * @returns The created session as an AdminSessionDto
   */
  create(input: AdminSessionCreateInput): Promise<AdminSessionDto>;

  /**
   * Rotate the stored refresh-token hash for a session.
   *
   * @param id - AdminSession primary key
   * @param refreshTokenHash - New SHA-256 hex digest of the refresh token
   */
  updateRefreshTokenHash(id: string, refreshTokenHash: string): Promise<void>;

  /**
   * List a user's sessions, newest first.
   *
   * @param userId - Owning AdminUser id
   * @param options - Optional active-only filter and result limit
   * @returns Matching sessions as AdminSessionDto records
   */
  findByUserId(userId: string, options?: AdminSessionFindOptions): Promise<AdminSessionDto[]>;

  /**
   * Revoke every active session belonging to a user, recording why on each.
   *
   * @param userId - Owning AdminUser id
   * @param reason - Why the sessions end, stored as each session's `revokeReason`: one reason
   *                 of `ADMIN_SESSION_REVOKE_REASONS`
   * @returns Count of sessions revoked
   */
  revokeAllForUser(userId: string, reason: AdminSessionRevokeReason): Promise<number>;

  /**
   * Permanently delete every session belonging to a user.
   *
   * @param userId - Owning AdminUser id
   * @returns Count of sessions deleted
   */
  deleteAllForUser(userId: string): Promise<number>;
}
