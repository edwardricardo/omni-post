/**
 * @file InMemoryAdminUserRepository.ts
 * @description In-memory implementation of AdminUserRepositoryPort for unit tests.
 *              Eliminates the need for a real database in tests that depend on
 *              admin user lookups (MfaService, RbacService, AuthService, etc.).
 *              Stores the full credential-bearing record internally and strips
 *              credentials on the public reads, mirroring the Prisma adapter.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type {
  AdminUserRepositoryPort,
  AdminUserCreateInput,
  AdminUserUpdate,
} from "../../../src/domain/repositories/AdminUserRepository.js";
import type {
  AdminUserDto,
  AdminUserCredentialsDto,
} from "../../../src/domain/repositories/ReadModelDtos.js";

/**
 * Optional resolver that maps between admin role names and role ids, so the
 * in-memory repo can faithfully model the real adapter where the persisted FK
 * is `roleId` while the DTO exposes the role `name`.
 */
export interface RoleNameIdResolver {
  idOf(name: string): string;
  nameOf(id: string): string;
}

/** Strip credential material from a stored record to the public DTO shape. */
function toPublic(user: AdminUserCredentialsDto): AdminUserDto {
  const {
    passwordHash: _passwordHash,
    passwordResetToken: _passwordResetToken,
    passwordResetExpires: _passwordResetExpires,
    mfaSecret: _mfaSecret,
    passwordHistory: _passwordHistory,
    mfaBackupCodes: _mfaBackupCodes,
    mfaBackupUsedAt: _mfaBackupUsedAt,
    ...rest
  } = user;
  return rest;
}

export class InMemoryAdminUserRepository implements AdminUserRepositoryPort {
  private users: Map<string, AdminUserCredentialsDto> = new Map();

  constructor(private readonly roleResolver?: RoleNameIdResolver) {}

  /** Seed the repository with credential-bearing user records */
  seed(users: AdminUserCredentialsDto[]): void {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.id, user);
    }
  }

  /** Add a single credential-bearing user */
  add(user: AdminUserCredentialsDto): void {
    this.users.set(user.id, user);
  }

  /** Test-only direct state patch (bypasses the port contract). */
  patch(id: string, data: Partial<AdminUserCredentialsDto>): void {
    const existing = this.users.get(id);
    if (existing) {
      this.users.set(id, { ...existing, ...data });
    }
  }

  /** Get a user directly with credentials (bypassing the port — for assertions) */
  get(id: string): AdminUserCredentialsDto | undefined {
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
    return ok(toPublic(user));
  }

  async findById(id: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = this.users.get(id);
    if (!user) return err("NOT_FOUND");
    return ok(toPublic(user));
  }

  async findByEmail(email: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (!user) return err("NOT_FOUND");
    return ok(toPublic(user));
  }

  async findCredentialsById(id: string): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
    const user = this.users.get(id);
    if (!user) return err("NOT_FOUND");
    return ok(user);
  }

  async findCredentialsByEmail(
    email: string
  ): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
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
    return ids
      .map((id) => this.users.get(id))
      .filter((u): u is AdminUserCredentialsDto => u !== undefined)
      .map(toPublic);
  }

  async create(input: AdminUserCreateInput): Promise<AdminUserDto> {
    const now = new Date();
    const user: AdminUserCredentialsDto = {
      id: `user-${this.users.size + 1}`,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: input.roleId,
      isActive: true,
      emailVerified: input.emailVerified ?? false,
      lastLoginAt: null,
      passwordResetToken: null,
      passwordResetExpires: null,
      mfaEnabled: false,
      mfaSecret: null,
      passwordHashAlgo: "argon2id",
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
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return toPublic(user);
  }

  async findAll(): Promise<AdminUserDto[]> {
    return [...this.users.values()].map(toPublic);
  }

  async update(id: string, data: AdminUserUpdate): Promise<AdminUserDto> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new Error(`AdminUser not found: ${id}`);
    }
    const roleName =
      data.roleId !== undefined
        ? (this.roleResolver?.nameOf(data.roleId) ?? data.roleId)
        : undefined;
    const updated: AdminUserCredentialsDto = {
      ...existing,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
      ...(roleName !== undefined && { role: roleName }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.department !== undefined && { department: data.department }),
      ...(data.team !== undefined && { team: data.team }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      ...(data.emailVerified !== undefined && { emailVerified: data.emailVerified }),
      ...(data.lastLoginAt !== undefined && { lastLoginAt: data.lastLoginAt }),
      ...(data.mfaEnabled !== undefined && { mfaEnabled: data.mfaEnabled }),
      ...(data.mfaSecret !== undefined && { mfaSecret: data.mfaSecret }),
      ...(data.passwordResetToken !== undefined && {
        passwordResetToken: data.passwordResetToken,
      }),
      ...(data.passwordResetExpires !== undefined && {
        passwordResetExpires: data.passwordResetExpires,
      }),
      updatedAt: new Date(),
    };
    this.users.set(id, updated);
    return toPublic(updated);
  }

  async findByRoleId(roleId: string): Promise<AdminUserDto[]> {
    return [...this.users.values()]
      .filter((u) => {
        const userRoleId = this.roleResolver?.idOf(u.role) ?? u.role;
        return userRoleId === roleId;
      })
      .map(toPublic);
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}
