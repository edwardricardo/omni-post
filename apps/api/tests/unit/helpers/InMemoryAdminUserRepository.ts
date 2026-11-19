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
} from "@core/domain/repositories/AdminUserRepository.js";
import type { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import type {
  AdminUserDto,
  AdminUserCredentialsDto,
} from "@core/domain/repositories/ReadModelDtos.js";

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

  /**
   * @method seed
   * @description Replace every stored user with the given credential-bearing records.
   * @param users - The records to hold
   */
  seed(users: AdminUserCredentialsDto[]): void {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.id, user);
    }
  }

  /**
   * @method add
   * @description Add a single credential-bearing user.
   * @param user - The record to hold
   */
  add(user: AdminUserCredentialsDto): void {
    this.users.set(user.id, user);
  }

  /**
   * @method patch
   * @description Test-only direct state change (bypasses the port contract).
   * @param id - The stored user to change; an unknown id changes nothing
   * @param data - The fields to overwrite
   */
  patch(id: string, data: Partial<AdminUserCredentialsDto>): void {
    const existing = this.users.get(id);
    if (existing) {
      this.users.set(id, { ...existing, ...data });
    }
  }

  /**
   * @method get
   * @description Get a user directly with credentials (bypassing the port — for assertions).
   * @param id - The stored user's id
   * @returns The stored record, or undefined when none has that id
   */
  get(id: string): AdminUserCredentialsDto | undefined {
    return this.users.get(id);
  }

  /**
   * @method clear
   * @description Remove every stored user.
   */
  clear(): void {
    this.users.clear();
  }

  /**
   * @method findActiveUser
   * @description Find a user by id (default) or by e-mail, compared without case, and
   *   check that it is active.
   * @param identifier - User ID or email address
   * @param type - Lookup type: "id" (default) or "email"
   * @returns Ok(user) when found and active, Err("NOT_FOUND") or Err("USER_INACTIVE")
   */
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

  /**
   * @method findById
   * @description Find a user by id, active or not.
   * @param id - The user's id
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  async findById(id: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = this.users.get(id);
    if (!user) return err("NOT_FOUND");
    return ok(toPublic(user));
  }

  /**
   * @method findByEmail
   * @description Find a user by e-mail, compared without case, active or not.
   * @param email - The e-mail to look up
   * @returns Ok(user) when found, Err("NOT_FOUND") otherwise
   */
  async findByEmail(email: string): Promise<Result<AdminUserDto, "NOT_FOUND">> {
    const user = [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (!user) return err("NOT_FOUND");
    return ok(toPublic(user));
  }

  /**
   * @method findCredentialsById
   * @description Find a user by id with its credential material.
   * @param id - The user's id
   * @returns Ok(user with credentials) when found, Err("NOT_FOUND") otherwise
   */
  async findCredentialsById(id: string): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
    const user = this.users.get(id);
    if (!user) return err("NOT_FOUND");
    return ok(user);
  }

  /**
   * @method findCredentialsByEmail
   * @description Find a user by e-mail, compared without case, with its credential material.
   * @param email - The e-mail to look up
   * @returns Ok(user with credentials) when found, Err("NOT_FOUND") otherwise
   */
  async findCredentialsByEmail(
    email: string
  ): Promise<Result<AdminUserCredentialsDto, "NOT_FOUND">> {
    const user = [...this.users.values()].find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (!user) return err("NOT_FOUND");
    return ok(user);
  }

  /**
   * @method validateActive
   * @description Check that an already-read user is active.
   * @param user - The user to check
   * @returns Ok when active, Err("USER_INACTIVE") when not
   */
  validateActive(user: AdminUserDto): Result<void, "USER_INACTIVE"> {
    if (!user.isActive) return err("USER_INACTIVE");
    return ok(undefined);
  }

  /**
   * @method findManyByIds
   * @description Find the users with the given ids, active or not; unknown ids are omitted.
   * @param ids - The ids to look up
   * @returns The users found, in the order of `ids`
   */
  async findManyByIds(ids: string[]): Promise<AdminUserDto[]> {
    return ids
      .map((id) => this.users.get(id))
      .filter((u): u is AdminUserCredentialsDto => u !== undefined)
      .map(toPublic);
  }

  /**
   * @method create
   * @description Store a new active user; an omitted optional field takes the column's default.
   * @param input - The creation fields
   * @returns The created user without credentials
   */
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
      mustChangePassword: input.mustChangePassword ?? false,
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

  /**
   * @method findAll
   * @description List every stored user, active or not.
   * @returns Every user without credentials
   */
  async findAll(): Promise<AdminUserDto[]> {
    return [...this.users.values()].map(toPublic);
  }

  /**
   * @method existsAny
   * @description Say whether any user is stored, active or not.
   * @returns Ok(true) when at least one is stored, Ok(false) otherwise
   */
  async existsAny(): Promise<Result<boolean, RepositoryFailureError>> {
    return ok(this.users.size > 0);
  }

  /**
   * @method update
   * @description Apply a partial update to a stored user.
   * @param id - The user to change
   * @param data - The fields to change; omitted keys are left as they are
   * @returns The updated user without credentials
   */
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

  /**
   * @method findByRoleId
   * @description List the users assigned to a role, resolving role names through the
   *   resolver when one is given.
   * @param roleId - The role's id
   * @returns The matching users without credentials
   */
  async findByRoleId(roleId: string): Promise<AdminUserDto[]> {
    return [...this.users.values()]
      .filter((u) => {
        const userRoleId = this.roleResolver?.idOf(u.role) ?? u.role;
        return userRoleId === roleId;
      })
      .map(toPublic);
  }

  /**
   * @method delete
   * @description Remove a stored user; an unknown id removes nothing.
   * @param id - The user to remove
   */
  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}
