/**
 * @file teamRoutes.test.ts
 * @description Unit tests for team management HTTP endpoints.
 *   Uses mocked Prisma stores and a real Fastify instance to test HTTP endpoint behavior.
 * @layer infrastructure
 */

import { randomBytes } from "node:crypto";
import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "../helpers/mockPrisma.js";

// Provide a valid 256-bit key so EncryptionService (resolved transitively by
// InviteTeamMemberUseCase → PlatformCredentialService) doesn't throw.
if (!process.env.PLATFORM_ENCRYPTION_KEY) {
  process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// TeamMember store with compound unique key support
const teamMemberStore = createStore<Record<string, unknown>>();
const teamMemberMock = buildModelMock(teamMemberStore, {
  isActive: true,
  role: "MEMBER",
  avatarUrl: null,
  invitedBy: null,
});

// Override findUnique to support Prisma compound keys like accountId_email
const originalFindUnique = teamMemberMock.findUnique;
teamMemberMock.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const { where } = args;
    // Handle compound unique keys: { accountId_email: { accountId, email } }
    if (where.accountId_email && typeof where.accountId_email === "object") {
      const compound = where.accountId_email as Record<string, unknown>;
      const flatWhere: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(compound)) {
        flatWhere[k] = v;
      }
      return originalFindUnique({ where: flatWhere, include: args.include });
    }
    return originalFindUnique(args);
  }
);

// Add extra models needed by team routes and their repositories
const extraModels = {
  teamMember: teamMemberMock,
  projectMember: buildModelMock(createStore()),
  post: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../../src/auth/customerAuthMiddleware.js", async () => {
  const { createCustomerAuthMock } = await import("../helpers/mockAuthMiddleware.js");
  return createCustomerAuthMock();
});

vi.mock("../../../src/lib/logger.js", () => {
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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const fastifyCookie = (await import("@fastify/cookie")).default;
const { teamRoutes } = await import("../../../src/team/teamRoutes.js");
const { authRoutes } = await import("../../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { AuthService, setRedisInstance } = await import("../../../src/auth/authService.js");
const { MfaService } = await import("../../../src/auth/mfaService.js");
const { PrismaAdminUserRepository } =
  await import("../../../src/infrastructure/repositories/PrismaAdminUserRepository.js");

setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `team-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123";

let app: import("fastify").FastifyInstance;
let adminToken: string;
let testAccountId: string;
let _testMemberId: string;

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(adminUserRepo);
  const authSvc = new AuthService(adminUserRepo, mfaSvc);
  container.registerInstance(TOKENS.AuthService, authSvc);

  localApp.decorate("container", container);
  await localApp.register(fastifyCookie);
  await localApp.register(authRoutes);
  await localApp.register(teamRoutes);
  await localApp.ready();
  return { app: localApp, authSvc };
}

describe("teamRoutes Unit Tests", () => {
  let authSvc: InstanceType<typeof AuthService>;

  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;
    authSvc = result.authSvc;

    // Create account via mock prisma
    const account = await (mockPrisma.prisma.account as { create: Function }).create({
      data: {
        email: `team-account-${timestamp}@example.com`,
        name: "Team Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    // Register admin user and get token
    await authSvc.registerAdmin(adminEmail, testPassword, "Team Admin", "ADMIN");
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: adminEmail, password: testPassword },
    });
    const loginBody = JSON.parse(loginRes.body);
    adminToken = loginBody.data?.accessToken ?? "";
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /team/invite", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        payload: {
          accountId: testAccountId,
          email: "member@example.com",
          name: "New Member",
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("invites a new team member successfully", async () => {
      const memberEmail = `member-${timestamp}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: memberEmail,
          name: "New Member",
          role: "MEMBER",
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBeTruthy();
      _testMemberId = body.data.id;
    });

    it("rejects duplicate email in same account", async () => {
      const memberEmail = `member-${timestamp}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: memberEmail,
          name: "Duplicate Member",
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(409);
      expect(body.ok).toBe(false);
    });

    it("rejects invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: "not-an-email",
          name: "Bad Email Member",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: "valid@example.com",
          name: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("invites member with VIEWER role", async () => {
      const viewerEmail = `viewer-${timestamp}@example.com`;
      const response = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: viewerEmail,
          name: "Viewer Member",
          role: "VIEWER",
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
    });
  });

  describe("GET /team", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/team?accountId=${testAccountId}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("lists team members for account", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/team?accountId=${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length >= 2).toBeTruthy();

      // Verify DTO shape
      const first = body.data[0];
      expect(first.id).toBeTruthy();
      expect(first.email).toBeTruthy();
      expect(first.name).toBeTruthy();
      expect(first.role).toBeTruthy();
      expect(typeof first.isActive === "boolean").toBeTruthy();
      expect(first.joinedAt).toBeTruthy();
    });

    it("rejects invalid accountId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/team?accountId=not-a-uuid",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("PATCH /team/:id/role", () => {
    let ownerMemberId: string;
    let targetMemberId: string;

    beforeAll(async () => {
      // Create an OWNER member for role change tests
      const ownerEmail = `owner-${timestamp}@example.com`;
      const ownerResponse = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: ownerEmail,
          name: "Owner Member",
          role: "OWNER",
        },
      });
      const ownerBody = JSON.parse(ownerResponse.body);
      ownerMemberId = ownerBody.data?.id;

      // Create a target member
      const targetEmail = `target-${timestamp}@example.com`;
      const targetResponse = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: targetEmail,
          name: "Target Member",
          role: "MEMBER",
        },
      });
      const targetBody = JSON.parse(targetResponse.body);
      targetMemberId = targetBody.data?.id;
    });

    it("updates role successfully when changer outranks target", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${targetMemberId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "VIEWER",
          changerMemberId: ownerMemberId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.updated).toBe(true);
    });

    it("rejects role update with insufficient hierarchy", async () => {
      // targetMemberId is now VIEWER, try to use them as changer
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${ownerMemberId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "MEMBER",
          changerMemberId: targetMemberId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(403);
      expect(body.ok).toBe(false);
    });

    it("returns 404 for non-existent member", async () => {
      const fakeId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${fakeId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "MEMBER",
          changerMemberId: ownerMemberId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(404);
      expect(body.ok).toBe(false);
    });

    it("rejects invalid role value", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/team/${targetMemberId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newRole: "SUPERADMIN",
          changerMemberId: ownerMemberId,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /team/:id", () => {
    let removableMemberId: string;
    let ownerForRemovalId: string;

    beforeAll(async () => {
      // Create an owner for removal operations
      const ownerEmail = `removal-owner-${timestamp}@example.com`;
      const ownerRes = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: ownerEmail,
          name: "Removal Owner",
          role: "OWNER",
        },
      });
      ownerForRemovalId = JSON.parse(ownerRes.body).data?.id;

      // Create a member to remove
      const removableEmail = `removable-${timestamp}@example.com`;
      const removableRes = await app.inject({
        method: "POST",
        url: "/team/invite",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountId: testAccountId,
          email: removableEmail,
          name: "Removable Member",
          role: "MEMBER",
        },
      });
      removableMemberId = JSON.parse(removableRes.body).data?.id;
    });

    it("deactivates a member successfully", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/team/${removableMemberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          changerMemberId: ownerForRemovalId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.removed).toBe(true);

      // Verify deactivation by listing
      const listResponse = await app.inject({
        method: "GET",
        url: `/team?accountId=${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const listBody = JSON.parse(listResponse.body);
      const removed = listBody.data.find((m: { id: string }) => m.id === removableMemberId);
      expect(removed).toBeTruthy();
      expect(removed.isActive).toBe(false);
    });

    it("rejects deactivation of owner", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/team/${ownerForRemovalId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          changerMemberId: ownerForRemovalId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(403);
      expect(body.ok).toBe(false);
    });

    it("returns 404 for non-existent member", async () => {
      const fakeId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
      const response = await app.inject({
        method: "DELETE",
        url: `/team/${fakeId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          changerMemberId: ownerForRemovalId,
        },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(404);
      expect(body.ok).toBe(false);
    });
  });
});
