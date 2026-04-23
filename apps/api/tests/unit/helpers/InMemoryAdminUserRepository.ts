/**
 * @file InMemoryAdminUserRepository.ts
 * @description In-memory implementation of AdminUserRepositoryPort for unit tests.
 *              Eliminates the need for a real database in tests that depend on
 *              admin user lookups (MfaService, RbacService, AuthService, etc.).
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type { AdminUserRepositoryPort } from "../../../src/domain/repositories/AdminUserRepository.js";
import type { AdminUserDto } from "../../../src/domain/repositories/ReadModelDtos.js";

export class InMemoryAdminUserRepository implements AdminUserRepositoryPort {
  private users: Map<string, AdminUserDto> = new Map();

  /** Seed the repository with user records */
  seed(users: AdminUserDto[]): void {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.id, user);
    }
  }

  /** Add a single user */
  add(user: AdminUserDto): void {
    this.users.set(user.id, user);
  }

  /** Update a user by ID (partial merge) */
  update(id: string, data: Partial<AdminUserDto>): void {
    const existing = this.users.get(id);
    if (existing) {
      this.users.set(id, { ...existing, ...data });
    }
  }

  /** Get a user directly (bypassing the port interface — for test assertions) */
  get(id: string): AdminUserDto | undefined {
    return this.users.get(id);
  }

  /** Clear all users */
  clear(): void {
    this.users.clear();
  }

  async findActiveUser(
    identifier: string,
    type: "email" | "id" = "id"
  ): Promise<Result<AdminUserDto, "NOT_FOUND" | "USER_INACTIVE">> {
    const user =
      type === "email"
        ? [...this.users.values()].find((u) => u.email.toLowerCase() === identifier.toLowerCase())
        : this.users.get(identifier);

    if (!user) return err("NOT_FOUND");
    if (!user.isActive) return err("USER_INACTIVE");
    return ok(user);
  }

  async findById(id: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = this.users.get(id);
    if (!user) return err("NOT_FOUND");
    return ok(user);
  }

  async findByEmail(email: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (!user) return err("NOT_FOUND");
    return ok(user);
  }

  validateActive(user: AdminUserDto): Result<void, "USER_INACTIVE"> {
    if (!user.isActive) return err("USER_INACTIVE");
    return ok(undefined);
  }

  async findManyByIds(ids: string[]): Promise<AdminUserDto[]> {
    return ids.map((id) => this.users.get(id)).filter((u): u is AdminUserDto => u !== undefined);
  }
}
