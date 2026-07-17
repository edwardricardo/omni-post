/**
 * @file tenantGuard.test.ts
 * @description Unit tests for the Prisma `$extends` tenant-guard extension
 *   (S2.1b). Tests the guard's decision matrix in isolation by exercising
 *   the inner `$allOperations` callback with synthesised inputs. Does NOT
 *   require a Prisma client or PostgreSQL — pure logic tests.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import {
  tenantGuardCheck,
  TenantContextMissingError,
  TenantContextMismatchError,
  getTenantScopedModels,
  type TenantContextProvider,
} from "../../../../../infra/prisma/src/extensions/tenantGuard.js";

/**
 * Thin wrapper around `tenantGuardCheck` so each test reads as a single
 * call with named inputs. Uses a default `query` stub when the test doesn't
 * supply its own.
 */
function callGuard(input: {
  provider: TenantContextProvider;
  model: string;
  operation: string;
  args: Record<string, unknown>;
  query?: (args: unknown) => Promise<unknown>;
}) {
  const queryFn = input.query ?? (async (a) => ({ called: true, args: a }));
  return tenantGuardCheck(
    {
      model: input.model,
      operation: input.operation,
      args: input.args,
      query: queryFn,
    },
    input.provider
  );
}

function makeProvider(overrides: Partial<TenantContextProvider> = {}): TenantContextProvider {
  return {
    getTenantContext: () => undefined,
    getSystemContext: () => undefined,
    ...overrides,
  };
}

describe("tenantGuardExtension", () => {
  describe("denylist (global tables)", () => {
    it("bypasses for Account model", async () => {
      const queryFn = vi.fn().mockResolvedValue("bypassed");
      const result = await callGuard({
        provider: makeProvider(),
        model: "Account",
        operation: "findFirst",
        args: { where: { id: "acc-1" } },
        query: queryFn,
      });
      expect(result).toBe("bypassed");
      expect(queryFn).toHaveBeenCalledWith({ where: { id: "acc-1" } });
    });

    it("bypasses for AuditLog model", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      await callGuard({
        provider: makeProvider(),
        model: "AuditLog",
        operation: "findMany",
        args: { where: { action: "LOGIN" } },
        query: queryFn,
      });
      expect(queryFn).toHaveBeenCalledWith({ where: { action: "LOGIN" } });
    });

    it("bypasses for ProviderBundle (global pricing config)", async () => {
      const queryFn = vi.fn();
      await callGuard({
        provider: makeProvider(),
        model: "ProviderBundle",
        operation: "findMany",
        args: {},
        query: queryFn,
      });
      expect(queryFn).toHaveBeenCalled();
    });
  });

  describe("tenant-scoped table + no context", () => {
    it("throws TenantContextMissingError on findFirst", async () => {
      await expect(
        callGuard({
          provider: makeProvider(),
          model: "ApiKey",
          operation: "findFirst",
          args: { where: { id: "key-1" } },
        })
      ).rejects.toThrow(TenantContextMissingError);
    });

    it("throws on update", async () => {
      // Pick a tenant-scoped model that's in the SET (Project is in the list).
      await expect(
        callGuard({
          provider: makeProvider(),
          model: "Project",
          operation: "update",
          args: { where: { id: "proj-1" }, data: { name: "new" } },
        })
      ).rejects.toThrow(TenantContextMissingError);
    });

    it("error carries model + operation", async () => {
      try {
        await callGuard({
          provider: makeProvider(),
          model: "MediaAsset",
          operation: "findMany",
          args: {},
        });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TenantContextMissingError);
        expect((e as Error).message).toContain("MediaAsset");
        expect((e as Error).message).toContain("findMany");
      }
    });
  });

  describe("tenant-scoped table + SystemContext (bypass)", () => {
    it("bypasses when SystemContext is active", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getSystemContext: () => ({ reason: "admin-impersonation" }),
      });
      await callGuard({
        provider,
        model: "Project",
        operation: "findMany",
        args: { where: { name: "X" } },
        query: queryFn,
      });
      expect(queryFn).toHaveBeenCalledWith({ where: { name: "X" } });
    });

    it("does not inject accountId under SystemContext", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getSystemContext: () => ({ reason: "system:test" }),
      });
      await callGuard({
        provider,
        model: "ApiKey",
        operation: "findFirst",
        args: { where: { id: "key-1" } },
        query: queryFn,
      });
      const calledWith = queryFn.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
      expect(calledWith.where?.accountId).toBeUndefined();
    });
  });

  describe("tenant-scoped table + TenantContext bound", () => {
    it("injects accountId into where when missing (findMany)", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "MediaAsset",
        operation: "findMany",
        args: {},
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { where: { accountId: string } };
      expect(calledArgs.where.accountId).toBe("acc-A");
    });

    it("injects accountId into where when missing (findFirst)", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "Mention",
        operation: "findFirst",
        args: { where: { topic: "X" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; topic: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.topic).toBe("X");
    });

    it("passes through when explicit accountId matches context", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ApiKey",
        operation: "findFirst",
        args: { where: { accountId: "acc-A", isActive: true } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { where: { accountId: string } };
      expect(calledArgs.where.accountId).toBe("acc-A");
    });

    it("bypasses transitively-scoped models like Post (not in direct list)", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "Post",
        operation: "findMany",
        args: { where: { accountId: "acc-B" } },
        query: queryFn,
      });
      expect(queryFn).toHaveBeenCalledWith({ where: { accountId: "acc-B" } });
    });

    it("throws TenantContextMismatchError on direct tenant table", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      try {
        await callGuard({
          provider,
          model: "ApiKey",
          operation: "findFirst",
          args: { where: { accountId: "acc-B" } },
        });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TenantContextMismatchError);
        expect((e as TenantContextMismatchError).contextAccountId).toBe("acc-A");
        expect((e as TenantContextMismatchError).queryAccountId).toBe("acc-B");
      }
    });

    it("injects accountId into data on create", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ApiKey",
        operation: "create",
        args: { data: { name: "test-key", isActive: true } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { data: { accountId: string } };
      expect(calledArgs.data.accountId).toBe("acc-A");
    });

    it("injects accountId into each row of createMany", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ApiKey",
        operation: "createMany",
        args: {
          data: [
            { name: "k1", isActive: true },
            { name: "k2", isActive: false },
          ],
        },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        data: Array<{ accountId: string }>;
      };
      expect(calledArgs.data).toHaveLength(2);
      expect(calledArgs.data[0]?.accountId).toBe("acc-A");
      expect(calledArgs.data[1]?.accountId).toBe("acc-A");
    });

    it("rejects create with mismatching explicit accountId", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await expect(
        callGuard({
          provider,
          model: "ApiKey",
          operation: "create",
          args: { data: { accountId: "acc-B", name: "k" } },
        })
      ).rejects.toThrow(TenantContextMismatchError);
    });
  });

  describe("externalNotificationConfig enrollment (Slice 1 — tenant-guard rollout)", () => {
    it("is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("externalNotificationConfig")).toBe(true);
    });

    it("injects accountId into where on findMany (list by projectId)", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ExternalNotificationConfig",
        operation: "findMany",
        args: { where: { projectId: "proj-B" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; projectId: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.projectId).toBe("proj-B");
    });

    it("injects accountId into upsert.create data", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ExternalNotificationConfig",
        operation: "upsert",
        args: {
          where: { id: "cfg-1" },
          create: { id: "cfg-1", accountId: "acc-A", projectId: "proj-1", label: "L" },
          update: { label: "L" },
        },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        create: { accountId: string };
        where: { accountId: string };
      };
      expect(calledArgs.create.accountId).toBe("acc-A");
      expect(calledArgs.where.accountId).toBe("acc-A");
    });

    it("throws TenantContextMismatchError when create.accountId disagrees with context", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await expect(
        callGuard({
          provider,
          model: "ExternalNotificationConfig",
          operation: "create",
          args: { data: { id: "cfg-1", accountId: "acc-B", projectId: "proj-1", label: "L" } },
        })
      ).rejects.toThrow(TenantContextMismatchError);
    });

    it("throws TenantContextMissingError when no context is bound", async () => {
      await expect(
        callGuard({
          provider: makeProvider(),
          model: "ExternalNotificationConfig",
          operation: "delete",
          args: { where: { id: "cfg-1" } },
        })
      ).rejects.toThrow(TenantContextMissingError);
    });
  });

  describe("campaign + scheduledReport enrollment (tenant-guard rollout)", () => {
    it("campaign is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("campaign")).toBe(true);
    });

    it("scheduledReport is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("scheduledReport")).toBe(true);
    });

    it("injects accountId into where on Campaign findMany (list by projectId)", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "Campaign",
        operation: "findMany",
        args: { where: { projectId: "proj-B" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; projectId: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.projectId).toBe("proj-B");
    });

    it("injects accountId into ScheduledReport upsert.create data", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ScheduledReport",
        operation: "upsert",
        args: {
          where: { id: "rep-1" },
          create: { id: "rep-1", accountId: "acc-A", projectId: "proj-1", name: "R" },
          update: { name: "R" },
        },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        create: { accountId: string };
        where: { accountId: string };
      };
      expect(calledArgs.create.accountId).toBe("acc-A");
      expect(calledArgs.where.accountId).toBe("acc-A");
    });

    it("throws TenantContextMismatchError when Campaign create.accountId disagrees with context", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await expect(
        callGuard({
          provider,
          model: "Campaign",
          operation: "create",
          args: { data: { id: "cmp-1", accountId: "acc-B", projectId: "proj-1", name: "C" } },
        })
      ).rejects.toThrow(TenantContextMismatchError);
    });
  });

  describe("recurringPost + trackedLink enrollment (Slice 3 — tenant-guard rollout)", () => {
    it("recurringPost is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("recurringPost")).toBe(true);
    });

    it("trackedLink is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("trackedLink")).toBe(true);
    });

    it("linkClick stays OUT of the guard list (no accountId; gated transitively)", () => {
      expect(getTenantScopedModels().has("linkClick")).toBe(false);
    });

    it("injects accountId into where on RecurringPost findMany (list by projectId)", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "RecurringPost",
        operation: "findMany",
        args: { where: { projectId: "proj-B" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; projectId: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.projectId).toBe("proj-B");
    });

    it("injects accountId into where on TrackedLink findUnique (get by id)", async () => {
      const queryFn = vi.fn().mockResolvedValue(null);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "TrackedLink",
        operation: "findUnique",
        args: { where: { id: "link-1" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; id: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.id).toBe("link-1");
    });

    it("injects accountId into TrackedLink create data", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "TrackedLink",
        operation: "create",
        args: { data: { id: "link-1", projectId: "proj-1", originalUrl: "https://x.test" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { data: { accountId: string } };
      expect(calledArgs.data.accountId).toBe("acc-A");
    });

    it("throws TenantContextMismatchError when RecurringPost create.accountId disagrees with context", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await expect(
        callGuard({
          provider,
          model: "RecurringPost",
          operation: "create",
          args: { data: { id: "rec-1", accountId: "acc-B", projectId: "proj-1", name: "R" } },
        })
      ).rejects.toThrow(TenantContextMismatchError);
    });

    it("throws TenantContextMissingError on TrackedLink findFirst when no context is bound", async () => {
      await expect(
        callGuard({
          provider: makeProvider(),
          model: "TrackedLink",
          operation: "findFirst",
          args: { where: { shortCode: "abc" } },
        })
      ).rejects.toThrow(TenantContextMissingError);
    });

    it("bypasses TrackedLink findFirst under SystemContext (public redirect / uniqueness probe)", async () => {
      const queryFn = vi.fn().mockResolvedValue(null);
      const provider = makeProvider({
        getSystemContext: () => ({ reason: "public-link-redirect" }),
      });
      await callGuard({
        provider,
        model: "TrackedLink",
        operation: "findFirst",
        args: { where: { OR: [{ shortCode: "abc" }, { vanitySlug: "abc" }] } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { where: { accountId?: string } };
      expect(calledArgs.where.accountId).toBeUndefined();
    });
  });

  describe("generatedImage enrollment (Slice 4 — tenant-guard rollout)", () => {
    it("generatedImage is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("generatedImage")).toBe(true);
    });

    it("injects accountId into where on GeneratedImage findMany (list by projectId)", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "GeneratedImage",
        operation: "findMany",
        args: { where: { projectId: "proj-B" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; projectId: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.projectId).toBe("proj-B");
    });

    it("injects accountId into where on GeneratedImage update", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "GeneratedImage",
        operation: "update",
        args: { where: { id: "img-1" }, data: { prompt: "x" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; id: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.id).toBe("img-1");
    });

    it("injects accountId into where on GeneratedImage delete", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "GeneratedImage",
        operation: "delete",
        args: { where: { id: "img-1" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; id: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.id).toBe("img-1");
    });

    it("injects accountId into GeneratedImage create data", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "GeneratedImage",
        operation: "create",
        args: {
          data: { id: "img-1", projectId: "proj-1", prompt: "p", imageUrl: "https://x.test/i.png" },
        },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { data: { accountId: string } };
      expect(calledArgs.data.accountId).toBe("acc-A");
    });

    it("throws TenantContextMismatchError when GeneratedImage create.accountId disagrees with context", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await expect(
        callGuard({
          provider,
          model: "GeneratedImage",
          operation: "create",
          args: { data: { id: "img-1", accountId: "acc-B", projectId: "proj-1", prompt: "p" } },
        })
      ).rejects.toThrow(TenantContextMismatchError);
    });

    it("throws TenantContextMissingError on GeneratedImage findFirst when no context is bound", async () => {
      await expect(
        callGuard({
          provider: makeProvider(),
          model: "GeneratedImage",
          operation: "findFirst",
          args: { where: { id: "img-1" } },
        })
      ).rejects.toThrow(TenantContextMissingError);
    });
  });

  describe("projectMember enrollment (Slice 5 — tenant-guard rollout)", () => {
    it("projectMember is a member of getTenantScopedModels()", () => {
      expect(getTenantScopedModels().has("projectMember")).toBe(true);
    });

    it("injects accountId into where on ProjectMember findMany (list by projectId)", async () => {
      const queryFn = vi.fn().mockResolvedValue([]);
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ProjectMember",
        operation: "findMany",
        args: { where: { projectId: "proj-B" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; projectId: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.projectId).toBe("proj-B");
    });

    it("injects accountId into where on ProjectMember update", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ProjectMember",
        operation: "update",
        args: { where: { id: "pm-1" }, data: { permissions: ["READ"] } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; id: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.id).toBe("pm-1");
    });

    it("injects accountId into where on ProjectMember delete", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ProjectMember",
        operation: "delete",
        args: { where: { id: "pm-1" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as {
        where: { accountId: string; id: string };
      };
      expect(calledArgs.where.accountId).toBe("acc-A");
      expect(calledArgs.where.id).toBe("pm-1");
    });

    it("injects accountId into ProjectMember create data", async () => {
      const queryFn = vi.fn();
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await callGuard({
        provider,
        model: "ProjectMember",
        operation: "create",
        args: { data: { id: "pm-1", projectId: "proj-1", memberId: "cu-1" } },
        query: queryFn,
      });
      const calledArgs = queryFn.mock.calls[0]?.[0] as { data: { accountId: string } };
      expect(calledArgs.data.accountId).toBe("acc-A");
    });

    it("throws TenantContextMismatchError when ProjectMember create.accountId disagrees with context", async () => {
      const provider = makeProvider({
        getTenantContext: () => ({ accountId: "acc-A" }),
      });
      await expect(
        callGuard({
          provider,
          model: "ProjectMember",
          operation: "create",
          args: { data: { id: "pm-1", accountId: "acc-B", projectId: "proj-1", memberId: "cu-1" } },
        })
      ).rejects.toThrow(TenantContextMismatchError);
    });

    it("throws TenantContextMissingError on ProjectMember findFirst when no context is bound", async () => {
      await expect(
        callGuard({
          provider: makeProvider(),
          model: "ProjectMember",
          operation: "findFirst",
          args: { where: { projectId: "proj-1" } },
        })
      ).rejects.toThrow(TenantContextMissingError);
    });
  });

  describe("model classification", () => {
    it("getTenantScopedModels returns 57 entries", () => {
      expect(getTenantScopedModels().size).toBe(57);
    });

    it("includes well-known tenant tables (project, apiKey, mediaAsset)", () => {
      const models = getTenantScopedModels();
      expect(models.has("project")).toBe(true);
      expect(models.has("apiKey")).toBe(true);
      expect(models.has("mediaAsset")).toBe(true);
      expect(models.has("socialMessage")).toBe(true);
    });

    it("excludes global tables (account, auditLog, providerBundle, post, channel, linkClick)", () => {
      const models = getTenantScopedModels();
      // Post and Channel are transitively scoped (via project FK), not in this direct list.
      // LinkClick has no accountId column and is gated transitively via the guarded
      // parent trackedLink lookup — same policy as campaignPost.
      expect(models.has("account")).toBe(false);
      expect(models.has("auditLog")).toBe(false);
      expect(models.has("providerBundle")).toBe(false);
      expect(models.has("post")).toBe(false);
      expect(models.has("channel")).toBe(false);
      expect(models.has("linkClick")).toBe(false);
    });
  });
});
