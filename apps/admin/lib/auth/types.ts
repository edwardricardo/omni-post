/**
 * @file types.ts
 * @description TypeScript type definitions for admin authentication including user profiles,
 * token pairs, login responses, Server Action state shapes, and the discriminated auth result union.
 */
import type { AdminRole } from "@shared/types";

export interface AdminUserProfile {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  timezone: string | null;
  locale: string | null;
  department: string | null;
  team: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  csrfToken: string;
}

export interface LoginResponse {
  user: AdminUserProfile;
  tokens: TokenPair;
  requiresMfa: boolean;
  mfaSessionToken?: string;
}

export interface LoginResult {
  success: boolean;
  redirectTo?: string;
  error?: string;
  requiresMfa?: boolean;
  mfaSessionToken?: string;
}

// ============================================================================
// Server Actions Auth Types (new pattern — replaces NextAuth)
// ============================================================================

/**
 * State shape for the admin login Server Action.
 * Compatible with React 19 useActionState.
 */
export interface AdminAuthState {
  error?: string;
  requiresMfa?: boolean;
  mfaSessionToken?: string;
}

/**
 * Discriminated union returned by authenticateAdmin().
 * Preserves the MFA signal that authenticateWithBackend() loses by returning null.
 */
export type AuthenticateAdminResult =
  | { status: "success"; user: AdminUserProfile; tokens: TokenPair }
  | { status: "mfa_required"; mfaSessionToken: string }
  | { status: "error"; error: string };
