/**
 * Admin Test Helper
 *
 * Generates valid admin JWT access tokens for testing admin routes
 * that use requireAdminAuth middleware.
 *
 * The tokens are signed with the same secret and parameters that
 * AdminAuthService.TokenService uses, so they pass verification
 * in requireAdminAuth middleware.
 */

import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { prisma } from "@infra/prisma";
import { adminAuthConfig } from "../../../src/admin/auth/adminAuthConfig.js";

/**
 * Generate a valid admin access token for testing.
 *
 * Matches the exact payload format from TokenService.generateAccessToken():
 * - sub, email, name, role, type="access", iat, exp
 * - Signed with adminAuthConfig.jwt.accessTokenSecret
 * - issuer: "omnipost-admin", audience: "omnipost-admin-api"
 */
export function generateAdminToken(user: {
  id: string;
  email: string;
  name: string;
  role: string;
}): string {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    type: "access",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
  };

  return jwt.sign(payload, adminAuthConfig.jwt.accessTokenSecret, {
    issuer: adminAuthConfig.jwt.issuer,
    audience: adminAuthConfig.jwt.audience,
  });
}

/**
 * Create a test admin user in the database and return the user + valid token.
 *
 * Uses prisma.adminUser.create() directly with argon2id password hashing.
 * The returned token is immediately usable with requireAdminAuth middleware.
 */
export async function createTestAdminUser(options: {
  email: string;
  name: string;
  password: string;
  role?: string;
}): Promise<{
  user: { id: string; email: string; name: string; role: string };
  token: string;
}> {
  const passwordHash = await argon2.hash(options.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Resolve role name to roleId for the Role table relation
  const roleName = options.role || "ADMIN";
  const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
  const roleId = roleRecord?.id ?? `role-${roleName.toLowerCase().replace(/_/g, "-")}`;

  const user = await prisma.adminUser.create({
    data: {
      email: options.email.toLowerCase(),
      name: options.name,
      passwordHash,
      passwordHashAlgo: "argon2id",
      roleId,
      isActive: true,
      emailVerified: true,
    },
  });

  const token = generateAdminToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: roleName,
  });

  return {
    user: { id: user.id, email: user.email, name: user.name, role: roleName },
    token,
  };
}

/**
 * Clean up a test admin user and all related data.
 *
 * Deletes in correct FK order:
 *   audit logs -> admin sessions -> admin user permissions -> admin user
 */
export async function cleanupTestAdminUser(userId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.adminSession.deleteMany({ where: { userId } });
  await prisma.adminUserPermission.deleteMany({ where: { userId } });
  await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {
    // User may already be deleted by the test
  });
}

/**
 * Find and clean up all test admin users matching an email pattern.
 */
export async function cleanupTestAdminUsersByEmail(emailPattern: string): Promise<void> {
  const users = await prisma.adminUser.findMany({
    where: { email: { contains: emailPattern } },
  });

  for (const user of users) {
    await cleanupTestAdminUser(user.id);
  }
}
