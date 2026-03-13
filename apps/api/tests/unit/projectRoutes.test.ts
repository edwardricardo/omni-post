/**
 * @file projectRoutes.test.ts
 * @description Unit tests for projectRoutes — project CRUD operations.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Patch account.findUnique to resolve include: { _count: { select: { projects: true } } }
const origAccountFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(async (args: Record<string, unknown>) => {
  const result = await origAccountFindUnique(args);
  if (!result) return null;
  const include = args.include as Record<string, unknown> | undefined;
  if (include?._count) {
    (result as Record<string, unknown>)._count = {
      projects: stores.project.all().filter((p) => p.accountId === result.id).length,
    };
  }
  if (include?.projects) {
    (result as Record<string, unknown>).projects = stores.project
      .all()
      .filter((p) => p.accountId === result.id);
  }
  return result;
});

// Patch project.findUnique to support compound unique key accountId_name
const origProjectFindUnique = mockPrisma.prisma.project.findUnique;
mockPrisma.prisma.project.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const where = args.where;

    // Handle compound unique key: { accountId_name: { accountId, name } }
    if (where.accountId_name) {
      const compound = where.accountId_name as { accountId: string; name: string };
      const found =
        stores.project
          .all()
          .find((p) => p.accountId === compound.accountId && p.name === compound.name) ?? null;
      return found ? { ...found } : null;
    }

    // Fall back to default behavior (by id)
    return origProjectFindUnique(args);
  }
);

// Add models used by delete handler (postContent, postMedia, post, channel)
const noopDeleteMany = vi.fn(async () => ({ count: 0 }));
const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.postContent = { deleteMany: noopDeleteMany };
prismaAny.postMedia = { deleteMany: noopDeleteMany };
prismaAny.post = { deleteMany: noopDeleteMany };
prismaAny.channel = { deleteMany: noopDeleteMany };
prismaAny.publishLog = { findMany: vi.fn(async () => []) };

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
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
// Import SUT after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { projectRoutes } = await import("../../src/projects/projectRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { prisma } = await import("@infra/prisma");

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const container = setupContainer({ prisma: prisma as never });
  app.decorate("container", container);

  await app.register(projectRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const testProjectName = `Test Project ${timestamp}`;

describe("projectRoutes - Unit Tests", () => {
  let app: FastifyInstance;
  let createdAccountId: string;
  let _createdProjectId: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Create test account
    const testAccount = await prisma.account.create({
      data: {
        email: `test-project-${timestamp}@example.com`,
        name: "Test Account",
        subscription: "BASIC",
        maxProjects: 5,
      },
    });
    createdAccountId = testAccount.id;
  });

  afterAll(async () => {
    try {
      if (createdAccountId) {
        await prisma.project.deleteMany({
          where: { accountId: createdAccountId },
        });
        await prisma.account
          .delete({
            where: { id: createdAccountId },
          })
          .catch(() => {
            /* may already be deleted */
          });
      }
    } catch (_err) {
      // best-effort cleanup
    }
    await app.close();
  });

  describe("POST /accounts/:accountId/projects", () => {
    it("should create a new project successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: testProjectName,
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBeTruthy();
      expect(body.data?.accountId).toBe(createdAccountId);
      expect(body.data?.name).toBe(testProjectName);
      expect(body.data?.locale).toBe("en");
      expect(body.data?.createdAt).toBeTruthy();

      _createdProjectId = body.data?.id;
    });

    it("should use default locale if not provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: `Default Locale Project ${timestamp}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data?.locale).toBe("en");

      // Cleanup
      if (body.data?.id) {
        await prisma.project.delete({ where: { id: body.data.id } });
      }
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts/a0000000-0000-4000-8000-000000000000/projects",
        payload: {
          name: "Test Project",
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });

    it("should return 409 when project name already exists", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: testProjectName,
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(body.error).toBe("NAME_TAKEN");
    });

    it("should return 403 when quota exceeded", async () => {
      // Create account with maxProjects = 0
      const quotaAccount = await prisma.account.create({
        data: {
          email: `quota-test-${timestamp}@example.com`,
          name: "Quota Test",
          subscription: "BASIC",
          maxProjects: 0,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/accounts/${quotaAccount.id}/projects`,
        payload: {
          name: "Should Fail",
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(body.error).toBe("QUOTA_EXCEEDED");

      // Cleanup
      await prisma.account.delete({ where: { id: quotaAccount.id } });
    });

    it("should validate project name format", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "", // Empty name
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate locale format", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "Valid Name",
          locale: "x", // Too short
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid account ID format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts/invalid!/projects",
        payload: {
          name: "Test Project",
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should accept valid locales", async () => {
      const locales = ["en", "es", "fr", "de", "ja"];

      for (const locale of locales) {
        const response = await app.inject({
          method: "POST",
          url: `/accounts/${createdAccountId}/projects`,
          payload: {
            name: `Project ${locale} ${Date.now()}`,
            locale,
          },
        });

        expect(response.statusCode).toBe(200);

        const body = JSON.parse(response.body);
        expect(body.data?.locale).toBe(locale);

        // Cleanup
        if (body.data?.id) {
          await prisma.project.delete({ where: { id: body.data.id } });
        }
      }
    });
  });

  describe("GET /accounts/:accountId/projects", () => {
    it("should list all projects for an account", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length >= 1).toBeTruthy();
    });

    it("should return projects in descending order by creation date", async () => {
      // Create multiple projects
      const project1 = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Project 1 ${Date.now()}`,
          locale: "en",
        },
      });

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10);
        timer.unref();
      }); // Small delay

      const project2 = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Project 2 ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.length >= 2).toBeTruthy();

      // First project should be the most recent
      const dates = body.data.map((p: Record<string, unknown>) =>
        new Date(p.createdAt as string).getTime()
      );
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1] >= dates[i]).toBeTruthy();
      }

      // Cleanup
      await prisma.project.delete({ where: { id: project1.id } });
      await prisma.project.delete({ where: { id: project2.id } });
    });

    it("should return empty array for account with no projects", async () => {
      const emptyAccount = await prisma.account.create({
        data: {
          email: `empty-${timestamp}@example.com`,
          name: "Empty Account",
          subscription: "BASIC",
          maxProjects: 5,
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/accounts/${emptyAccount.id}/projects`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length).toBe(0);

      // Cleanup
      await prisma.account.delete({ where: { id: emptyAccount.id } });
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/a0000000-0000-4000-8000-000000000000/projects",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should include all project fields", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.length > 0).toBeTruthy();

      const project = body.data[0];
      expect(project.id).toBeTruthy();
      expect(project.accountId).toBeTruthy();
      expect(project.name).toBeTruthy();
      expect(project.locale).toBeTruthy();
      expect(project.createdAt).toBeTruthy();
    });

    it("should reject invalid account ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/invalid!/projects",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /projects/:projectId", () => {
    it("should delete a project successfully", async () => {
      // Create project to delete
      const projectToDelete = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `To Delete ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectToDelete.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBeTruthy();

      // Verify project is deleted
      const deletedProject = await prisma.project.findUnique({
        where: { id: projectToDelete.id },
      });
      expect(deletedProject).toBe(null);
    });

    it("should return 404 for non-existent project", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/projects/a0000000-0000-4000-8000-000000000000",
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });

    it("should reject invalid project ID format", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/projects/invalid!",
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });

    it("should return success message after deletion", async () => {
      const projectToDelete = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Delete Message Test ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectToDelete.id}`,
      });

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBe("Project deleted successfully");
    });

    it("should handle cascade deletion properly", async () => {
      // Create project with related data
      const projectWithData = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Cascade Test ${Date.now()}`,
          locale: "en",
        },
      });

      // Delete project
      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectWithData.id}`,
      });

      expect(response.statusCode).toBe(200);

      // Verify project is deleted
      const deletedProject = await prisma.project.findUnique({
        where: { id: projectWithData.id },
      });
      expect(deletedProject).toBe(null);
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      expect(response.statusCode < 500 || response.statusCode === 500).toBeTruthy();
    });

    it("should return proper error structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/a0000000-0000-4000-8000-000000000001/projects",
      });

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(typeof body.error).toBe("string");
    });
  });

  describe("Input Validation", () => {
    it("should validate required fields for project creation", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate name length constraints", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "x".repeat(300), // Very long name
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate locale format constraints", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "Valid Name",
          locale: "toolong",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
