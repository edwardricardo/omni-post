/**
 * @file AdminSessionRepository.ts
 * @description Repository port for admin session persistence — create, refresh-token
 *              rotation, per-user listing, and bulk revocation. DTO mirrors the
 *              persisted AdminSession row field-for-field.
 * @layer domain
 */

import type { JsonValue } from "./ReadModelDtos.js";

/**
 * Flat DTO for a persisted AdminSession row.
 * Mirrors the Prisma `AdminSession` model without the Prisma import.
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
   * Revoke every active session belonging to a user.
   *
   * @param userId - Owning AdminUser id
   * @returns Count of sessions revoked
   */
  revokeAllForUser(userId: string): Promise<number>;

  /**
   * Permanently delete every session belonging to a user.
   *
   * @param userId - Owning AdminUser id
   * @returns Count of sessions deleted
   */
  deleteAllForUser(userId: string): Promise<number>;
}
