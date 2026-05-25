/**
 * @file authTypes.ts
 * @description Shared authentication interfaces and types extracted from authService.ts
 *              to break circular dependencies between auth sub-modules.
 * @layer infrastructure
 */

import type { AdminRoleKind } from "@core/domain/repositories/ReadModelDtos.js";

export interface TokenPayload {
  userId: string;
  email: string;
  role: AdminRoleKind;
  sessionId: string;
  deviceFingerprint?: string;
  tokenVersion?: number;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  mfaToken?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenVersion?: number;
  sessionId?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: AdminRoleKind;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  mfaEnabled: boolean;
  projectId?: string;
  accountId?: string;
  createdAt?: Date;
}

export interface SessionFingerprint {
  userAgent: string;
  ipAddress: string;
  deviceId?: string;
  browserFingerprint?: string;
}
