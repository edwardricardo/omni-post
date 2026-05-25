/**
 * @file AdminUserAdminService.ts
 * @description Admin-user CRUD orchestration for the admin console: list, create,
 *              detail, update, (de)activate. Composes AdminUserRepository,
 *              RoleRepository and AdminSessionRepository (ports) so the route
 *              handler never touches Prisma. Actor-level authorization (who may
 *              change roles / deactivate whom) stays in the route handler, which
 *              owns the request context.
 * @layer infrastructure
 */

import { randomBytes } from "node:crypto";
import { ok, err, type Result } from "@shared/types";
import { hashPassword } from "../auth/passwordHashing.js";
import type {
  AdminUserRepositoryPort,
  AdminUserUpdate,
} from "@core/domain/repositories/AdminUserRepository.js";
import type { RoleRepository } from "@core/domain/repositories/RoleRepository.js";
import type { AdminSessionRepository } from "@core/domain/repositories/AdminSessionRepository.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";

/** Input for creating an admin user. */
export interface CreateAdminUserInput {
  email: string;
  name: string;
  role: string;
  password?: string;
}

/** Partial edit payload for an admin user (admin-console editable fields). */
export interface UpdateAdminUserInput {
  name?: string;
  email?: string;
  role?: string;
  department?: string | null;
  team?: string | null;
  avatarUrl?: string | null;
}

/**
 * Orchestrates admin-user management over domain ports.
 *
 * Register as a singleton in the DI container via TOKENS.AdminUserAdminService.
 */
export class AdminUserAdminService {
  constructor(
    private readonly adminUserRepo: AdminUserRepositoryPort,
    private readonly roleRepo: RoleRepository,
    private readonly sessionRepo: AdminSessionRepository
  ) {}

  /**
   * @method list
   * @description List every admin user (active and inactive).
   * @returns All admin users as AdminUserDto records
   */
  async list(): Promise<AdminUserDto[]> {
    return this.adminUserRepo.findAll();
  }

  /**
   * @method create
   * @description Create an admin user, generating a random temporary password
   *   when none is supplied. The role name is resolved to its ID.
   * @param input - email, name, role, optional password
   * @returns Ok({ user, temporaryPassword }) or Err("EMAIL_EXISTS")
   */
  async create(
    input: CreateAdminUserInput
  ): Promise<Result<{ user: AdminUserDto; temporaryPassword: string }, "EMAIL_EXISTS">> {
    const existing = await this.adminUserRepo.findByEmail(input.email);
    if (existing.ok) {
      return err("EMAIL_EXISTS");
    }

    const temporaryPassword = input.password ?? randomBytes(12).toString("base64url").slice(0, 16);
    const passwordHash = await hashPassword(temporaryPassword);
    const roleRecord = await this.roleRepo.findByName(input.role || "ADMIN");
    const roleId = roleRecord?.id ?? "role-admin";

    const user = await this.adminUserRepo.create({
      email: input.email,
      name: input.name,
      roleId,
      passwordHash,
    });
    return ok({ user, temporaryPassword });
  }

  /**
   * @method getDetail
   * @description Fetch a single admin user plus their active session count.
   * @param id - AdminUser primary key
   * @returns Ok({ user, sessionsCount }) or Err("NOT_FOUND")
   */
  async getDetail(
    id: string
  ): Promise<Result<{ user: AdminUserDto; sessionsCount: number }, "NOT_FOUND">> {
    const found = await this.adminUserRepo.findById(id);
    if (!found.ok) {
      return err("NOT_FOUND");
    }
    const sessions = await this.sessionRepo.findByUserId(id);
    return ok({ user: found.value, sessionsCount: sessions.length });
  }

  /**
   * @method update
   * @description Apply an admin-console edit. Enforces email uniqueness and role
   *   validity; actor-level authorization is the caller's responsibility.
   * @param id - AdminUser primary key
   * @param updates - Editable fields
   * @returns Ok(user) or Err("EMAIL_EXISTS" | "INVALID_ROLE" | "NOT_FOUND")
   */
  async update(
    id: string,
    updates: UpdateAdminUserInput
  ): Promise<Result<AdminUserDto, "EMAIL_EXISTS" | "INVALID_ROLE" | "NOT_FOUND">> {
    const exists = await this.adminUserRepo.findById(id);
    if (!exists.ok) {
      return err("NOT_FOUND");
    }

    if (updates.email !== undefined) {
      const other = await this.adminUserRepo.findByEmail(updates.email);
      if (other.ok && other.value.id !== id) {
        return err("EMAIL_EXISTS");
      }
    }

    const data: AdminUserUpdate = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.email !== undefined) data.email = updates.email;
    if (updates.role !== undefined) {
      const roleRecord = await this.roleRepo.findByName(updates.role);
      if (!roleRecord) {
        return err("INVALID_ROLE");
      }
      data.roleId = roleRecord.id;
    }
    if (updates.department !== undefined) data.department = updates.department;
    if (updates.team !== undefined) data.team = updates.team;
    if (updates.avatarUrl !== undefined) data.avatarUrl = updates.avatarUrl;

    const user = await this.adminUserRepo.update(id, data);
    return ok(user);
  }

  /**
   * @method deactivate
   * @description Soft-deactivate an admin user. Refuses to deactivate the last
   *   active SUPER_ADMIN.
   * @param id - AdminUser primary key
   * @returns Ok(user) or Err("NOT_FOUND" | "ALREADY_INACTIVE" | "LAST_SUPER_ADMIN")
   */
  async deactivate(
    id: string
  ): Promise<Result<AdminUserDto, "NOT_FOUND" | "ALREADY_INACTIVE" | "LAST_SUPER_ADMIN">> {
    const found = await this.adminUserRepo.findById(id);
    if (!found.ok) {
      return err("NOT_FOUND");
    }
    if (!found.value.isActive) {
      return err("ALREADY_INACTIVE");
    }
    if (found.value.role === "SUPER_ADMIN") {
      const role = await this.roleRepo.findByName("SUPER_ADMIN");
      const activeCount = role
        ? (await this.adminUserRepo.findByRoleId(role.id)).filter((u) => u.isActive).length
        : 0;
      if (activeCount <= 1) {
        return err("LAST_SUPER_ADMIN");
      }
    }
    const user = await this.adminUserRepo.update(id, { isActive: false });
    return ok(user);
  }

  /**
   * @method activate
   * @description Reactivate an admin user.
   * @param id - AdminUser primary key
   * @returns Ok(user) or Err("NOT_FOUND" | "ALREADY_ACTIVE")
   */
  async activate(id: string): Promise<Result<AdminUserDto, "NOT_FOUND" | "ALREADY_ACTIVE">> {
    const found = await this.adminUserRepo.findById(id);
    if (!found.ok) {
      return err("NOT_FOUND");
    }
    if (found.value.isActive) {
      return err("ALREADY_ACTIVE");
    }
    const user = await this.adminUserRepo.update(id, { isActive: true });
    return ok(user);
  }

  /**
   * @method findById
   * @description Look up an admin user by ID (for flows that need the target's
   *   contact info, e.g. admin-initiated password reset).
   * @param id - AdminUser primary key
   * @returns Ok(user) or Err("NOT_FOUND")
   */
  async findById(id: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    return this.adminUserRepo.findById(id);
  }
}
