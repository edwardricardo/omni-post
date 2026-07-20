/**
 * @file rbacRoutes.test.ts
 * @description Unit tests for rbacRoutes. Uses in-memory mocked Prisma stores
 *              and a real Fastify instance to test RBAC HTTP endpoint behavior.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/admin/auth/adminAuthMiddleware.js", async () => {
  const { createAdminAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createAdminAuthMock();
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    logger: noopLogger,
    authLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const { rbacRoutes } = await import("../../src/auth/rbacRoutes.js");
const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/admin/auth/MfaService.js");
const { PrismaAdminMfaUserRepository } =
  await import("../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js");
const { PrismaCustomerMfaUserRepository } =
  await import("../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js");
const { RbacService } = await import("../../src/auth/rbacService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { PrismaAdminSessionRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");

// ---------------------------------------------------------------------------
// Shared service instances
// ---------------------------------------------------------------------------

setRedisInstance(null as unknown as import("ioredis").default);

const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
const sessionRepo = new PrismaAdminSessionRepository(mockPrisma.prisma as never);
const mfaService = new MfaService(
  new PrismaAdminMfaUserRepository(mockPrisma.prisma as never),
  new PrismaCustomerMfaUserRepository(mockPrisma.prisma as never),
  new InMemoryAuditLogRepository()
);
const authService = new AuthService(
  mockPrisma.prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new InMemoryAuditLogRepository()
);
const rbacService = new RbacService(adminUserRepo, roleRepo, new InMemoryAuditLogRepository());

async function createTestApp() {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = new Container();
  container.registerInstance(TOKENS.PrismaClient, mockPrisma.prisma);
  container.registerInstance(TOKENS.AuthService, authService);
  container.registerInstance(TOKENS.RbacService, rbacService);
  // S4.4 moved RoleManagementService to @core/application; rbacRoutes resolves
  // it at register time. Provide a minimal stub for this test — the role-write
  // endpoints aren't exercised here (this test covers read-only permission
  // checks). Methods that ARE invoked would need a richer fake.
  const roleManagementStub = {
    createRole: vi.fn(),
    updateRole: vi.fn(),
    setRolePermissions: vi.fn(),
    deleteRole: vi.fn(),
  };
  container.registerInstance(TOKENS.RoleManagementService, roleManagementStub);
  app.decorate("container", container);

  await app.register(rbacRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `admin-rbac-${timestamp}@example.com`;
const superAdminEmail = `superadmin-rbac-${timestamp}@example.com`;
const supportEmail = `support-rbac-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: ReturnType<typeof Fastify>;
let adminToken: string;
let superAdminToken: string;
let supportToken: string;
let _adminUserId: string;
let superAdminUserId: string;
let supportUserId: string;

describe("rbacRoutes Unit Tests", () => {
  beforeAll(async () => {
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();

    app = await createTestApp();

    // Create admin user
    const adminResult = await authService.registerAdmin(
      adminEmail,
      testPassword,
      "Admin User",
      "ADMIN"
    );
    if (adminResult.ok) {
      _adminUserId = adminResult.value.id;
    }

    // Create super admin user
    const superAdminResult = await authService.registerAdmin(
      superAdminEmail,
      testPassword,
      "Super Admin User",
      "SUPER_ADMIN"
    );
    if (superAdminResult.ok) {
      superAdminUserId = superAdminResult.value.id;
    }

    // Create support user
    const supportResult = await authService.registerAdmin(
      supportEmail,
      testPassword,
      "Support User",
      "SUPPORT"
    );
    if (supportResult.ok) {
      supportUserId = supportResult.value.id;
    }

    // Login to get tokens
    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }

    const superAdminLogin = await authService.login(
      { email: superAdminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (superAdminLogin.ok && "tokens" in superAdminLogin.value) {
      superAdminToken = superAdminLogin.value.tokens.accessToken;
    }

    const supportLogin = await authService.login(
      { email: supportEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (supportLogin.ok && "tokens" in supportLogin.value) {
      supportToken = supportLogin.value.tokens.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /auth/permissions", () => {
    it("should get permissions for authenticated admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.user).toBeTruthy();
      expect(body.data?.user?.role).toBe("ADMIN");
      expect(Array.isArray(body.data?.permissions)).toBeTruthy();
    });

    it("should get permissions for super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.user?.role).toBe("SUPER_ADMIN");
      expect(Array.isArray(body.data?.permissions)).toBeTruthy();
    });

    it("should get permissions for support user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.user?.role).toBe("SUPPORT");
      expect(Array.isArray(body.data?.permissions)).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/rbac/roles", () => {
    it("should get all roles as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.roles)).toBeTruthy();
      expect(body.data?.permissionCategories).toBeTruthy();
      expect(Array.isArray(body.data?.allPermissions)).toBeTruthy();
    });

    it("should allow support role with user:read permission", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      // SUPPORT has user:read permission, which is sufficient for read-only RBAC endpoints
      expect(response.statusCode).toBe(200);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/rbac/roles/:role", () => {
    it("should get specific role info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.role).toBeTruthy();
    });

    it("should get SUPER_ADMIN role info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPER_ADMIN",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should get SUPPORT role info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPPORT",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/INVALID_ROLE",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // ROLE_NOT_FOUND returns 404 (DB-backed roles)
      expect(response.statusCode).toBe(404);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/rbac/roles/:role/users", () => {
    it("should get users by ADMIN role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.users)).toBeTruthy();
      expect(body.data?.count >= 0).toBeTruthy();
    });

    it("should get users by SUPER_ADMIN role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPER_ADMIN/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.users)).toBeTruthy();
    });

    it("should get users by SUPPORT role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPPORT/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/INVALID/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN/users",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("PUT /admin/rbac/users/:userId/role", () => {
    it("should update user role as super admin", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "ADMIN",
          reason: "Promotion to admin role for increased responsibilities",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.newRole).toBe("ADMIN");
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          role: "SUPER_ADMIN",
          reason: "Should not be allowed without super admin",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject invalid role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "INVALID_ROLE",
          reason: "Testing invalid role",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject short reason", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "SUPPORT",
          reason: "short",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject modifying own role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${superAdminUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "ADMIN",
          reason: "Attempting to modify own role which should fail",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        payload: {
          role: "ADMIN",
          reason: "Valid reason for role change",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should restore support user back to SUPPORT role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "SUPPORT",
          reason: "Restoring original SUPPORT role for subsequent tests",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data?.newRole).toBe("SUPPORT");
    });
  });

  describe("POST /auth/permissions/check", () => {
    it("should check single permission", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ["user:read"],
          requireAll: false,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.data?.hasAccess === "boolean").toBeTruthy();
      expect(body.data?.permissions).toBeTruthy();
    });

    it("should check multiple permissions with requireAll", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          permissions: ["user:read", "user:manage"],
          requireAll: true,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should check permissions with requireAll false", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ["user:read", "system:configure"],
          requireAll: false,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid permissions", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ["INVALID_PERMISSION"],
          requireAll: false,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject empty permissions array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: [],
          requireAll: false,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        payload: {
          permissions: ["USER_READ"],
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/rbac/hierarchy", () => {
    it("should get role hierarchy as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.hierarchy).toBeTruthy();
      expect(body.data?.permissionMatrix).toBeTruthy();
      expect(Array.isArray(body.data?.roles)).toBeTruthy();
    });

    it("should show canModifyRoles for super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.currentUser?.canModifyRoles).toBe(true);
    });

    it("should allow support role with user:read permission", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      // SUPPORT has user:read permission, sufficient for read endpoints
      expect(response.statusCode).toBe(200);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/rbac/status", () => {
    it("should get RBAC system status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.status).toBe("active");
      expect(body.data?.statistics).toBeTruthy();
      expect(typeof body.data?.statistics?.totalUsers === "number").toBeTruthy();
      expect(typeof body.data?.statistics?.totalRoles === "number").toBeTruthy();
    });

    it("should include role distribution", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(body.data?.statistics?.roleDistribution)).toBeTruthy();
    });

    it("should allow support role with user:read permission", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      // SUPPORT has user:read permission, sufficient for read endpoints
      expect(response.statusCode).toBe(200);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
