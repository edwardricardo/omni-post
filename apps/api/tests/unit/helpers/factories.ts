/**
 * @file factories.ts
 * @description Test data factories for unit tests. Creates typed domain DTOs
 *              with sensible defaults that can be overridden per-test.
 * @layer infrastructure
 */

import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { AdminRoleKind } from "@core/domain/repositories/ReadModelDtos.js";

let counter = 0;

/** Generate a unique ID for test data */
function nextId(prefix = "test"): string {
  counter++;
  return `${prefix}-${counter.toString().padStart(6, "0")}`;
}

/** Reset the counter (call in beforeEach if needed) */
export function resetFactoryCounter(): void {
  counter = 0;
}

/**
 * Create a test AdminUserDto with sensible defaults.
 * All fields can be overridden via the `overrides` parameter.
 */
export function makeAdminUser(overrides?: Partial<AdminUserDto>): AdminUserDto {
  const id = overrides?.id ?? nextId("admin-user");
  const now = new Date("2026-01-01T00:00:00Z");

  return {
    id,
    email: `${id}@test.example.com`,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$salt$hash",
    name: `Test User ${id}`,
    role: "ADMIN" as AdminRoleKind,
    isActive: true,
    emailVerified: true,
    lastLoginAt: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    mfaEnabled: false,
    mfaSecret: null,
    passwordHashAlgo: "argon2",
    passwordChangedAt: now,
    passwordHistory: [],
    mustChangePassword: false,
    mfaBackupCodes: [],
    mfaBackupUsedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lockReason: null,
    maxConcurrentSessions: 5,
    timezone: null,
    locale: null,
    department: null,
    team: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
