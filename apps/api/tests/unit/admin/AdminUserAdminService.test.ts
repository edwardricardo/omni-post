/**
 * @file adminUserAdminService.test.ts
 * @description Unit tests for AdminUserAdminService — the admin-user CRUD
 *              orchestrator over AdminUserRepository/RoleRepository/AdminSession
 *              ports. Verifies email-uniqueness, role resolution, the
 *              last-SUPER_ADMIN safety guard, and the (de)activation/detail flows
 *              with in-memory port fakes.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { AdminUserAdminService } from "../../../src/admin/AdminUserAdminService.js";
import type {
  AdminUserRepositoryPort,
  AdminUserCreateInput,
  AdminUserUpdate,
} from "@core/domain/repositories/AdminUserRepository.js";
import type { RoleRepository, RoleDto } from "@core/domain/repositories/RoleRepository.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";

function makeDto(overrides: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    id: "u-1",
    email: "a@test.com",
    name: "Admin A",
    role: "ADMIN",
    isActive: true,
    emailVerified: true,
    lastLoginAt: null,
    mfaEnabled: false,
    passwordHashAlgo: "argon2id",
    passwordChangedAt: new Date(0),
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lockReason: null,
    maxConcurrentSessions: 5,
    timezone: null,
    locale: null,
    department: null,
    team: null,
    avatarUrl: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function makeAdminUserRepo(seed: AdminUserDto[]): AdminUserRepositoryPort {
  const users = [...seed];
  let seq = users.length;
  const fake = {
    findAll: async (): Promise<AdminUserDto[]> => [...users],
    findById: async (id: string): Promise<Result<AdminUserDto, "NOT_FOUND">> => {
      const u = users.find((x) => x.id === id);
      return u ? ok(u) : err("NOT_FOUND");
    },
    findByEmail: async (email: string): Promise<Result<AdminUserDto, "NOT_FOUND">> => {
      const u = users.find((x) => x.email === email.toLowerCase());
      return u ? ok(u) : err("NOT_FOUND");
    },
    findByRoleId: async (roleId: string): Promise<AdminUserDto[]> =>
      users.filter((x) => x.role === roleId),
    create: async (input: AdminUserCreateInput): Promise<AdminUserDto> => {
      const u = makeDto({
        id: `u-${++seq}`,
        email: input.email,
        name: input.name,
        role: input.roleId as AdminUserDto["role"],
      });
      users.push(u);
      return u;
    },
    update: async (id: string, data: AdminUserUpdate): Promise<AdminUserDto> => {
      const idx = users.findIndex((x) => x.id === id);
      const updated = makeDto({ ...users[idx], ...data } as Partial<AdminUserDto>);
      users[idx] = updated;
      return updated;
    },
  };
  return fake as unknown as AdminUserRepositoryPort;
}

function makeRoleRepo(roles: Record<string, string>): RoleRepository {
  return {
    findByName: async (name: string): Promise<RoleDto | null> =>
      roles[name] ? ({ id: roles[name], name } as RoleDto) : null,
  } as unknown as RoleRepository;
}

function makeSessionRepo(count: number): AdminSessionRepository {
  return {
    findByUserId: async () => Array.from({ length: count }, (_, i) => ({ id: `s-${i}` })),
  } as unknown as AdminSessionRepository;
}

describe("AdminUserAdminService", () => {
  let service: AdminUserAdminService;

  beforeEach(() => {
    service = new AdminUserAdminService(
      makeAdminUserRepo([makeDto()]),
      makeRoleRepo({ ADMIN: "role-admin", SUPPORT: "role-support", SUPER_ADMIN: "role-super" }),
      makeSessionRepo(2)
    );
  });

  describe("create", () => {
    it("returns EMAIL_EXISTS when the email is already taken", async () => {
      const result = await service.create({ email: "a@test.com", name: "Dup", role: "ADMIN" });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("EMAIL_EXISTS");
    });

    it("creates a user and returns a generated temporary password", async () => {
      const result = await service.create({ email: "new@test.com", name: "New", role: "ADMIN" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.email).toBe("new@test.com");
        expect(result.value.temporaryPassword).toHaveLength(16);
      }
    });
  });

  describe("getDetail", () => {
    it("returns the user plus the session count", async () => {
      const result = await service.getDetail("u-1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.sessionsCount).toBe(2);
    });

    it("returns NOT_FOUND for an unknown id", async () => {
      const result = await service.getDetail("nope");
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });
  });

  describe("update", () => {
    it("returns INVALID_ROLE for an unknown role name", async () => {
      const result = await service.update("u-1", { role: "WIZARD" });
      expect(!result.ok && result.error).toBe("INVALID_ROLE");
    });

    it("returns NOT_FOUND for an unknown id", async () => {
      const result = await service.update("nope", { name: "X" });
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });

    it("updates editable fields", async () => {
      const result = await service.update("u-1", { name: "Renamed", department: "Eng" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Renamed");
        expect(result.value.department).toBe("Eng");
      }
    });
  });

  describe("deactivate", () => {
    it("refuses to deactivate the last active SUPER_ADMIN", async () => {
      // The fake aligns roleId === role-name so findByName→findByRoleId chains
      // resolve to the seeded SUPER_ADMIN (AdminUserDto.role is the role name).
      const svc = new AdminUserAdminService(
        makeAdminUserRepo([makeDto({ id: "su-1", role: "SUPER_ADMIN", isActive: true })]),
        makeRoleRepo({ SUPER_ADMIN: "SUPER_ADMIN" }),
        makeSessionRepo(0)
      );
      const result = await svc.deactivate("su-1");
      expect(!result.ok && result.error).toBe("LAST_SUPER_ADMIN");
    });

    it("returns ALREADY_INACTIVE when the user is not active", async () => {
      const svc = new AdminUserAdminService(
        makeAdminUserRepo([makeDto({ id: "u-2", isActive: false })]),
        makeRoleRepo({}),
        makeSessionRepo(0)
      );
      const result = await svc.deactivate("u-2");
      expect(!result.ok && result.error).toBe("ALREADY_INACTIVE");
    });

    it("deactivates a regular active user", async () => {
      const result = await service.deactivate("u-1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.isActive).toBe(false);
    });
  });

  describe("activate", () => {
    it("returns ALREADY_ACTIVE when the user is already active", async () => {
      const result = await service.activate("u-1");
      expect(!result.ok && result.error).toBe("ALREADY_ACTIVE");
    });
  });
});
