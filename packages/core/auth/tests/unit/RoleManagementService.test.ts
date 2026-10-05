/**
 * @file RoleManagementService.test.ts
 * @description Unit tests for RoleManagementService — createRole validation,
 *   duplicate name guard, and deleteRole guarded paths.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import type { LoggerPort } from "@ports/core";
import { RoleManagementService } from "../../src/RoleManagementService.js";
import type { RoleManagementRepository } from "@core/domain/repositories/RoleManagementRepository.js";
import type { RbacCacheInvalidatorPort } from "@core/domain/repositories/RbacCacheInvalidatorPort.js";

const NOW = new Date("2024-01-01T00:00:00Z");

function makeRoleDetail(
  overrides: Partial<{
    id: string;
    name: string;
    description: string;
    level: number;
    isSystem: boolean;
    isActive: boolean;
    permissions: string[];
    userCount: number;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: "role-uuid-001",
    name: "CUSTOM_ROLE",
    description: "test",
    level: 10,
    isSystem: false,
    isActive: true,
    permissions: [] as string[],
    userCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMockRepo(
  opts: {
    findByName?: unknown;
    create?: unknown;
    findSummaryById?: unknown;
    delete?: unknown;
  } = {}
): RoleManagementRepository {
  const detail = makeRoleDetail();
  return {
    findByName: vi.fn(async () => opts.findByName ?? ok(null)),
    create: vi.fn(async () => opts.create ?? ok(detail)),
    findDetailById: vi.fn(async () => ok(detail)),
    findSummaryById: vi.fn(
      async () =>
        opts.findSummaryById ??
        ok({ id: detail.id, name: detail.name, isSystem: false, userCount: 0 })
    ),
    update: vi.fn(async () => ok(detail)),
    replacePermissions: vi.fn(async () => ok(detail)),
    delete: vi.fn(async () => opts.delete ?? ok(undefined)),
    list: vi.fn(async () => ok([])),
  } as unknown as RoleManagementRepository;
}

function makeMockCache(): RbacCacheInvalidatorPort {
  return { invalidate: vi.fn(async () => undefined) } as unknown as RbacCacheInvalidatorPort;
}

function makeMockLogger() {
  return { warn: vi.fn(), error: vi.fn() } satisfies LoggerPort;
}

describe("RoleManagementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createRole", () => {
    it("returns the created role detail when input is valid", async () => {
      const svc = new RoleManagementService(makeMockRepo(), makeMockCache(), makeMockLogger());
      const r = await svc.createRole({
        name: "CUSTOM_ROLE",
        description: "A test role",
        level: 10,
        permissions: [],
      });
      assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : String(r.error)}`);
      assert.strictEqual(r.value.name, "CUSTOM_ROLE");
    });

    it("returns INVALID_NAME when the name does not match the pattern", async () => {
      const svc = new RoleManagementService(makeMockRepo(), makeMockCache(), makeMockLogger());
      const r = await svc.createRole({
        name: "invalid name",
        description: "test",
        level: 5,
        permissions: [],
      });
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "INVALID_NAME");
    });

    it("returns LEVEL_TOO_HIGH when level is >= 100", async () => {
      const svc = new RoleManagementService(makeMockRepo(), makeMockCache(), makeMockLogger());
      const r = await svc.createRole({
        name: "HIGH_ROLE",
        description: "test",
        level: 100,
        permissions: [],
      });
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "LEVEL_TOO_HIGH");
    });

    it("returns DUPLICATE_NAME when a role with the same name already exists", async () => {
      const existingRole = { id: "existing-id", name: "CUSTOM_ROLE" };
      const svc = new RoleManagementService(
        makeMockRepo({ findByName: ok(existingRole) }),
        makeMockCache(),
        makeMockLogger()
      );
      const r = await svc.createRole({
        name: "CUSTOM_ROLE",
        description: "test",
        level: 10,
        permissions: [],
      });
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "DUPLICATE_NAME");
    });
  });

  describe("deleteRole", () => {
    it("returns void ok when the role exists, is not a system role, and has no users", async () => {
      const svc = new RoleManagementService(makeMockRepo(), makeMockCache(), makeMockLogger());
      const r = await svc.deleteRole("role-uuid-001");
      assert.ok(r.ok);
    });

    it("returns ROLE_NOT_FOUND when the summary is null", async () => {
      const svc = new RoleManagementService(
        makeMockRepo({ findSummaryById: ok(null) }),
        makeMockCache(),
        makeMockLogger()
      );
      const r = await svc.deleteRole("nonexistent-id");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "ROLE_NOT_FOUND");
    });

    it("returns SYSTEM_ROLE when the found role is a system role", async () => {
      const svc = new RoleManagementService(
        makeMockRepo({
          findSummaryById: ok({ id: "sys-id", name: "SUPER_ADMIN", isSystem: true, userCount: 0 }),
        }),
        makeMockCache(),
        makeMockLogger()
      );
      const r = await svc.deleteRole("sys-id");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "SYSTEM_ROLE");
    });

    it("returns ROLE_IN_USE when the role has assigned users", async () => {
      const svc = new RoleManagementService(
        makeMockRepo({
          findSummaryById: ok({
            id: "used-id",
            name: "CUSTOM_ROLE",
            isSystem: false,
            userCount: 3,
          }),
        }),
        makeMockCache(),
        makeMockLogger()
      );
      const r = await svc.deleteRole("used-id");
      assert.ok(!r.ok);
      assert.strictEqual(r.error, "ROLE_IN_USE");
    });

    it("returns DATABASE_ERROR and reports the cause through the injected logger when the repository throws", async () => {
      const cause = new Error("connection reset");
      const repo = makeMockRepo();
      vi.mocked(repo.findSummaryById).mockRejectedValue(cause);
      const logger = makeMockLogger();
      const svc = new RoleManagementService(repo, makeMockCache(), logger);

      const r = await svc.deleteRole("role-uuid-001");

      assert.ok(!r.ok);
      assert.strictEqual(r.error, "DATABASE_ERROR");
      expect(logger.error).toHaveBeenCalledWith({ err: cause }, "Delete role error");
    });
  });
});
