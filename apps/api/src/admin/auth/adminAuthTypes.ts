/**
 * @file adminAuthTypes.ts
 * @description TypeScript type definitions for admin authentication system including
 *              login flows, JWT tokens, sessions, MFA, password policies, and RBAC.
 * @layer infrastructure
 * - Security events and audit logging
 */

import type { AdminRole } from "@shared/types";

// ============================================================================
// Core Authentication Types
// ============================================================================

/**
 * Admin user profile returned after successful authentication
 */
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

/**
 * JWT Access Token payload (short-lived, 15 minutes)
 */
export interface AccessTokenPayload {
  sub: string; // User ID
  email: string;
  name: string;
  role: AdminRole;
  type: "access";
  iat: number; // Issued at
  exp: number; // Expires at
  deviceId?: string; // Device fingerprint for session binding
}

/**
 * JWT Refresh Token payload (long-lived, 7 days)
 */
export interface RefreshTokenPayload {
  sub: string; // User ID
  sessionId: string; // Session ID for tracking
  type: "refresh";
  iat: number;
  exp: number;
  deviceId?: string;
}

/**
 * Token pair returned to client
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // Access token expiration in seconds
  csrfToken: string; // CSRF protection token
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
  mfaToken?: string; // TOTP code if MFA is enabled
  rememberMe: boolean; // Extend refresh token expiration (defaults to false in schema)
  deviceId?: string; // Device fingerprint
  deviceName?: string; // Browser/OS identification
}

/**
 * Login response
 */
export interface LoginResponse {
  user: AdminUserProfile;
  tokens: TokenPair;
  requiresMfa: boolean; // True if MFA is required but not provided
  mfaSessionToken?: string; // Temporary token for completing MFA
}

/**
 * Refresh token request
 */
export interface RefreshTokenRequest {
  refreshToken: string;
  csrfToken: string; // CSRF protection
}

/**
 * Refresh token response
 */
export interface RefreshTokenResponse {
  tokens: TokenPair;
  user: AdminUserProfile;
}

/**
 * Logout request
 */
export interface LogoutRequest {
  refreshToken?: string; // Optional: specific session to logout
  allSessions?: boolean; // Logout all sessions
}

/**
 * Change password request
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  mfaToken?: string; // Required if MFA is enabled
}

/**
 * Reset password request (forgot password flow)
 */
export interface ResetPasswordRequest {
  email: string;
}

/**
 * Reset password confirmation
 */
export interface ResetPasswordConfirmRequest {
  token: string;
  newPassword: string;
}

// ============================================================================
// MFA (Multi-Factor Authentication) Types
// ============================================================================

/**
 * MFA setup response (returns QR code and backup codes)
 */
export interface MfaSetupResponse {
  secret: string; // Base32 encoded secret for TOTP
  qrCodeUrl: string; // Data URL for QR code image
  backupCodes: string[]; // One-time backup codes (10 codes)
  recoveryCodes: string[]; // Alias for backupCodes
}

/**
 * MFA verification request
 */
export interface MfaVerifyRequest {
  token: string; // 6-digit TOTP code
  sessionToken?: string; // Temporary session token from login
}

/**
 * MFA backup code usage request
 */
export interface MfaBackupCodeRequest {
  code: string;
  sessionToken?: string;
}

/**
 * MFA status response
 */
export interface MfaStatusResponse {
  enabled: boolean;
  backupCodesRemaining: number;
}

// ============================================================================
// Session Management Types
// ============================================================================

/**
 * Active session information
 */
export interface SessionInfo {
  id: string;
  deviceName: string | null;
  deviceId: string | null;
  ipAddress: string | null;
  location: GeographicLocation | null;
  lastActivityAt: Date;
  createdAt: Date;
  expiresAt: Date;
  isCurrentSession: boolean;
}

/**
 * Geographic location from IP
 */
export interface GeographicLocation {
  city?: string;
  country?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
}

/**
 * Session revocation request
 */
export interface RevokeSessionRequest {
  sessionId: string;
  reason?: string;
}

// ============================================================================
// Security & Device Fingerprinting Types
// ============================================================================

/**
 * Device fingerprint data
 */
export interface DeviceFingerprint {
  deviceId: string; // Hashed fingerprint
  userAgent: string;
  ipAddress: string;
  deviceName?: string; // Parsed from user agent
  location?: GeographicLocation;
}

/**
 * Login attempt record
 */
export interface LoginAttempt {
  email: string;
  success: boolean;
  failureReason?: LoginFailureReason;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  location?: GeographicLocation;
  threatScore?: number; // 0-100
  isBlocked: boolean;
  requiresCaptcha: boolean;
  attemptedAt: Date;
}

/**
 * Reasons for login failure
 */
export type LoginFailureReason =
  | "INVALID_PASSWORD"
  | "ACCOUNT_LOCKED"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "USER_NOT_FOUND"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_INACTIVE"
  | "SUSPICIOUS_ACTIVITY"
  | "RATE_LIMIT_EXCEEDED";

/**
 * Account lock reasons
 */
export type AccountLockReason =
  | "BRUTE_FORCE"
  | "ADMIN_LOCKED"
  | "SUSPICIOUS_ACTIVITY"
  | "PASSWORD_POLICY_VIOLATION"
  | "SECURITY_BREACH";

// ============================================================================
// Password Policy Types
// ============================================================================

/**
 * Password validation result
 */
export interface PasswordValidation {
  valid: boolean;
  errors: string[];
  strength: PasswordStrength;
  suggestions?: string[];
}

/**
 * Password strength levels
 */
export type PasswordStrength = "WEAK" | "FAIR" | "GOOD" | "STRONG" | "VERY_STRONG";

/**
 * Password policy configuration
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventPasswordReuse: number; // How many previous passwords to check
  maxPasswordAge: number; // Days before password must be changed
  minPasswordAge: number; // Days before password can be changed again
}

// ============================================================================
// RBAC (Role-Based Access Control) Types
// ============================================================================

/**
 * Permission definition
 */
export interface Permission {
  resource: string; // e.g., 'accounts', 'projects', 'webhooks'
  action: string; // e.g., 'read', 'write', 'delete', 'admin'
  scope?: string; // Optional scope limitation (e.g., specific project IDs)
  conditions?: PermissionConditions;
}

/**
 * Permission conditions (e.g., time-based, IP-based)
 */
export interface PermissionConditions {
  ipWhitelist?: string[];
  timeRestrictions?: TimeRestriction[];
  customConditions?: Record<string, unknown>;
}

/**
 * Time-based restrictions
 */
export interface TimeRestriction {
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  daysOfWeek?: number[]; // 0=Sunday, 6=Saturday
  timezone?: string;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  granted: boolean;
  reason?: string;
  matchedPermission?: Permission;
}

// ============================================================================
// Audit & Security Events Types
// ============================================================================

/**
 * Security event types for audit logging
 */
export type SecurityEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "MFA_ENABLED"
  | "MFA_DISABLED"
  | "MFA_VERIFIED"
  | "MFA_FAILED"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_UNLOCKED"
  | "SESSION_CREATED"
  | "SESSION_REFRESHED"
  | "SESSION_REVOKED"
  | "PERMISSION_GRANTED"
  | "PERMISSION_REVOKED"
  | "ROLE_CHANGED"
  | "SUSPICIOUS_ACTIVITY_DETECTED"
  | "BRUTE_FORCE_DETECTED";

/**
 * Security event data for audit logging
 */
export interface SecurityEvent {
  type: SecurityEventType;
  userId?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  location?: GeographicLocation;
  details?: Record<string, unknown>;
  success: boolean;
  error?: string;
  timestamp: Date;
}

// ============================================================================
// Service Method Return Types (Result Pattern)
// ============================================================================

/**
 * Auth service error codes
 */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_INACTIVE"
  | "EMAIL_NOT_VERIFIED"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "CSRF_TOKEN_MISMATCH"
  | "PASSWORD_TOO_WEAK"
  | "PASSWORD_REUSED"
  | "PASSWORD_EXPIRED"
  | "RATE_LIMIT_EXCEEDED"
  | "SUSPICIOUS_ACTIVITY"
  | "PERMISSION_DENIED"
  | "USER_NOT_FOUND"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

/**
 * Authentication context (extracted from request)
 */
export interface AuthContext {
  user: AdminUserProfile;
  sessionId: string;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  permissions?: Permission[];
}

/**
 * Request context with security metadata
 */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  deviceName?: string;
  csrfToken?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * JWT configuration
 */
export interface JwtConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenExpiration: string; // e.g., '15m'
  refreshTokenExpiration: string; // e.g., '7d'
  refreshTokenExpirationRememberMe: string; // e.g., '30d'
  issuer: string;
  audience: string;
}

/**
 * Admin auth service configuration
 */
export interface AdminAuthConfig {
  jwt: JwtConfig;
  passwordPolicy: PasswordPolicy;
  mfa: {
    issuer: string; // For TOTP QR code
    backupCodesCount: number;
  };
  security: {
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
    sessionInactivityTimeout: number; // Minutes
    maxConcurrentSessions: number;
    requireMfaForRole: AdminRole[];
  };
  rateLimit: {
    loginAttemptsPerMinute: number;
    loginAttemptsPerHour: number;
  };
}
