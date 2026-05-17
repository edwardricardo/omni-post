/**
 * @file CustomerUser.ts
 * @description Domain entity representing a customer-side user. Customer users
 *   belong to an Account, authenticate via email/password, hold a roleId pointing
 *   to a CustomerRole row (DB-backed RBAC), and access the client dashboard
 *   (not the admin panel). The entity also carries membership + invitation state.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";

/**
 * Properties required to construct a CustomerUser.
 *
 * `permissions` is a snapshot loaded by the repository from the
 * `CustomerRolePermission` table at hydration time. The entity does not hit the
 * database — it operates on the cached snapshot. Use cases that mutate roles
 * are responsible for refreshing the snapshot on the next read.
 */
export interface CustomerUserProps {
  readonly id: string;
  readonly accountId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roleId: string;
  readonly roleName: string; // snapshot of CustomerRole.name (OWNER/MANAGER/MEMBER/VIEWER) at hydration
  readonly roleLevel: number; // snapshot of CustomerRole.level
  readonly permissions: ReadonlySet<string>; // snapshot of CustomerRolePermission.permission for this roleId
  readonly isActive: boolean;
  readonly isEmailVerified: boolean;
  readonly emailVerifyToken?: string;
  readonly emailVerifyExpiry?: Date;
  readonly resetToken?: string;
  readonly resetTokenExpiry?: Date;
  readonly mfaEnabled: boolean;
  readonly mfaSecret?: string;
  readonly lastLoginAt?: Date;
  readonly invitedBy?: string;
  readonly inviteToken?: string;
  readonly inviteTokenExpiry?: Date;
  readonly joinedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt?: Date;
}

/**
 * Input for creating a new CustomerUser entity.
 */
export interface CreateCustomerUserInput {
  readonly id: string;
  readonly accountId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly roleLevel: number;
  readonly permissions: ReadonlySet<string>;
  readonly invitedBy?: string;
  readonly inviteToken?: string;
  readonly inviteTokenExpiry?: Date;
}

/**
 * Publicly-safe DTO returned by toJSON (never exposes secrets).
 */
export interface CustomerUserPublicDto {
  readonly id: string;
  readonly accountId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly roleLevel: number;
  readonly permissions: readonly string[];
  readonly isActive: boolean;
  readonly isEmailVerified: boolean;
  readonly mfaEnabled: boolean;
  readonly lastLoginAt: string | null;
  readonly joinedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @class CustomerUser
 * @description Represents a customer-side user with authentication, membership,
 *   and invitation state. The role is stored as roleId (FK to CustomerRole)
 *   plus denormalised snapshots (roleName/roleLevel/permissions) for fast checks
 *   without DB round-trips. Never leaks secrets via toJSON().
 */
export class CustomerUser {
  private _id: string;
  private _accountId: string;
  private _email: string;
  private _passwordHash: string;
  private _firstName: string;
  private _lastName: string;
  private _roleId: string;
  private _roleName: string;
  private _roleLevel: number;
  private _permissions: ReadonlySet<string>;
  private _isActive: boolean;
  private _isEmailVerified: boolean;
  private _emailVerifyToken: string | undefined;
  private _emailVerifyExpiry: Date | undefined;
  private _resetToken: string | undefined;
  private _resetTokenExpiry: Date | undefined;
  private _mfaEnabled: boolean;
  private _mfaSecret: string | undefined;
  private _lastLoginAt: Date | undefined;
  private _invitedBy: string | undefined;
  private _inviteToken: string | undefined;
  private _inviteTokenExpiry: Date | undefined;
  private _joinedAt: Date;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _deletedAt: Date | undefined;

  private constructor(props: CustomerUserProps) {
    this._id = props.id;
    this._accountId = props.accountId;
    this._email = props.email;
    this._passwordHash = props.passwordHash;
    this._firstName = props.firstName;
    this._lastName = props.lastName;
    this._roleId = props.roleId;
    this._roleName = props.roleName;
    this._roleLevel = props.roleLevel;
    this._permissions = props.permissions;
    this._isActive = props.isActive;
    this._isEmailVerified = props.isEmailVerified;
    this._emailVerifyToken = props.emailVerifyToken;
    this._emailVerifyExpiry = props.emailVerifyExpiry;
    this._resetToken = props.resetToken;
    this._resetTokenExpiry = props.resetTokenExpiry;
    this._mfaEnabled = props.mfaEnabled;
    this._mfaSecret = props.mfaSecret;
    this._lastLoginAt = props.lastLoginAt;
    this._invitedBy = props.invitedBy;
    this._inviteToken = props.inviteToken;
    this._inviteTokenExpiry = props.inviteTokenExpiry;
    this._joinedAt = props.joinedAt;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    this._deletedAt = props.deletedAt;
  }

  /**
   * @method create
   * @description Factory method: validates email + name + accountId, returns Result.
   *   Does NOT hash the password (application layer's responsibility).
   *   roleId/roleName/roleLevel/permissions must be resolved by the caller from
   *   the CustomerRole DB row before constructing the entity.
   */
  static create(input: CreateCustomerUserInput): Result<CustomerUser, InvalidValueError> {
    const trimmedEmail = (input.email || "").trim();
    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      return err(new InvalidValueError("email", input.email, "Invalid email address"));
    }

    if (!input.firstName || input.firstName.trim().length === 0) {
      return err(new InvalidValueError("firstName", input.firstName, "First name cannot be empty"));
    }

    if (!input.lastName || input.lastName.trim().length === 0) {
      return err(new InvalidValueError("lastName", input.lastName, "Last name cannot be empty"));
    }

    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(new InvalidValueError("accountId", input.accountId, "Account ID is required"));
    }

    if (!input.roleId || input.roleId.trim().length === 0) {
      return err(new InvalidValueError("roleId", input.roleId, "Role ID is required"));
    }

    const now = new Date();
    return ok(
      new CustomerUser({
        id: input.id,
        accountId: input.accountId,
        email: trimmedEmail.toLowerCase(),
        passwordHash: input.passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        roleId: input.roleId,
        roleName: input.roleName,
        roleLevel: input.roleLevel,
        permissions: input.permissions,
        isActive: true,
        isEmailVerified: false,
        mfaEnabled: false,
        ...(input.invitedBy !== undefined && { invitedBy: input.invitedBy }),
        ...(input.inviteToken !== undefined && { inviteToken: input.inviteToken }),
        ...(input.inviteTokenExpiry !== undefined && {
          inviteTokenExpiry: input.inviteTokenExpiry,
        }),
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  /**
   * @method reconstitute
   * @description Re-creates a CustomerUser from persisted data (no validation).
   */
  static reconstitute(props: CustomerUserProps): CustomerUser {
    return new CustomerUser(props);
  }

  // ---- Getters ----

  get id(): string {
    return this._id;
  }
  get accountId(): string {
    return this._accountId;
  }
  get email(): string {
    return this._email;
  }
  get passwordHash(): string {
    return this._passwordHash;
  }
  get firstName(): string {
    return this._firstName;
  }
  get lastName(): string {
    return this._lastName;
  }
  get fullName(): string {
    return `${this._firstName} ${this._lastName}`;
  }
  get roleId(): string {
    return this._roleId;
  }
  get roleName(): string {
    return this._roleName;
  }
  get roleLevel(): number {
    return this._roleLevel;
  }
  get permissions(): ReadonlySet<string> {
    return this._permissions;
  }
  get isActive(): boolean {
    return this._isActive;
  }
  get isEmailVerified(): boolean {
    return this._isEmailVerified;
  }
  get emailVerifyToken(): string | undefined {
    return this._emailVerifyToken;
  }
  get emailVerifyExpiry(): Date | undefined {
    return this._emailVerifyExpiry;
  }
  get resetToken(): string | undefined {
    return this._resetToken;
  }
  get resetTokenExpiry(): Date | undefined {
    return this._resetTokenExpiry;
  }
  get mfaEnabled(): boolean {
    return this._mfaEnabled;
  }
  get mfaSecret(): string | undefined {
    return this._mfaSecret;
  }
  get lastLoginAt(): Date | undefined {
    return this._lastLoginAt;
  }
  get invitedBy(): string | undefined {
    return this._invitedBy;
  }
  get inviteToken(): string | undefined {
    return this._inviteToken;
  }
  get inviteTokenExpiry(): Date | undefined {
    return this._inviteTokenExpiry;
  }
  get joinedAt(): Date {
    return this._joinedAt;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get deletedAt(): Date | undefined {
    return this._deletedAt;
  }
  get isOwner(): boolean {
    return this._roleName === "OWNER";
  }
  get isPendingInvitation(): boolean {
    // A user with an active invite token + no password hash (or empty) is a
    // pending invitation that hasn't been accepted yet.
    return (
      (this._passwordHash === "" || this._passwordHash.length === 0) &&
      this._inviteToken !== undefined
    );
  }

  // ---- Authorization ----

  /**
   * @method hasPermission
   * @description Returns true if this user's role grants the permission.
   *   O(1) check against the snapshot Set; no DB round-trip.
   * @param permission - resource:action string (e.g. "post:edit")
   */
  hasPermission(permission: string): boolean {
    return this._permissions.has(permission);
  }

  /**
   * @method canManageRoleLevel
   * @description Returns true if THIS user outranks (strictly greater level) a
   *   target role level. Used to validate that the changer can modify another
   *   user's role: the changer must outrank both the target's current role and
   *   the role being assigned.
   * @param targetLevel - the level of the role being managed
   */
  canManageRoleLevel(targetLevel: number): boolean {
    return this._roleLevel > targetLevel;
  }

  // ---- Domain behaviour ----

  /**
   * @method updateRole
   * @description Replaces this user's role with a new role snapshot. Returns
   *   InvariantViolationError if the changer cannot manage the current or
   *   target role (hierarchy enforcement: changer.level must be strictly
   *   greater than both current.level and new.level).
   *
   *   The caller (use case) is responsible for refreshing the permissions
   *   snapshot from the new role's CustomerRolePermission rows.
   */
  updateRole(
    newRoleId: string,
    newRoleName: string,
    newRoleLevel: number,
    newPermissions: ReadonlySet<string>,
    changerRoleLevel: number
  ): Result<void, InvariantViolationError> {
    if (changerRoleLevel <= this._roleLevel) {
      return err(
        new InvariantViolationError("Cannot change role of a user with equal or higher role")
      );
    }
    if (changerRoleLevel <= newRoleLevel) {
      return err(
        new InvariantViolationError("Cannot assign a role equal to or higher than your own")
      );
    }
    this._roleId = newRoleId;
    this._roleName = newRoleName;
    this._roleLevel = newRoleLevel;
    this._permissions = newPermissions;
    this._updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method markEmailVerified
   * @description Marks email as verified and clears verification token.
   */
  markEmailVerified(): void {
    this._isEmailVerified = true;
    this._emailVerifyToken = undefined;
    this._emailVerifyExpiry = undefined;
    this._updatedAt = new Date();
  }

  /**
   * @method recordLogin
   * @description Updates the last login timestamp.
   */
  recordLogin(): void {
    this._lastLoginAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * @method deactivate
   * @description Marks the user as inactive (soft disable). OWNERs cannot be
   *   deactivated to prevent locking out the account.
   */
  deactivate(): Result<void, InvariantViolationError> {
    if (this.isOwner) {
      return err(new InvariantViolationError("Cannot deactivate the account owner"));
    }
    this._isActive = false;
    this._updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method reactivate
   * @description Marks the user as active again.
   */
  reactivate(): void {
    this._isActive = true;
    this._updatedAt = new Date();
  }

  /**
   * @method updateName
   * @description Updates the user's first and last names. Trims whitespace and
   *   rejects empty values.
   */
  updateName(firstName: string, lastName: string): Result<void, InvalidValueError> {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (trimmedFirst.length === 0) {
      return err(new InvalidValueError("firstName", firstName, "First name cannot be empty"));
    }
    if (trimmedLast.length === 0) {
      return err(new InvalidValueError("lastName", lastName, "Last name cannot be empty"));
    }
    this._firstName = trimmedFirst;
    this._lastName = trimmedLast;
    this._updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method setInviteToken
   * @description Sets an invitation token and its expiry (used when re-issuing
   *   an invitation that has already expired).
   */
  setInviteToken(token: string, expiry: Date): void {
    this._inviteToken = token;
    this._inviteTokenExpiry = expiry;
    this._updatedAt = new Date();
  }

  /**
   * @method acceptInvitation
   * @description Marks the invitation as accepted: clears the invite token,
   *   sets the password hash, marks email as verified. Called when a pending
   *   invitee completes signup.
   */
  acceptInvitation(passwordHash: string): Result<void, InvariantViolationError> {
    if (this._inviteToken === undefined) {
      return err(new InvariantViolationError("No pending invitation to accept"));
    }
    if (passwordHash.length === 0) {
      return err(new InvariantViolationError("Password hash is required to accept invitation"));
    }
    this._passwordHash = passwordHash;
    this._inviteToken = undefined;
    this._inviteTokenExpiry = undefined;
    this._isEmailVerified = true;
    this._updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method setResetToken
   * @description Sets a password reset token with expiry.
   */
  setResetToken(token: string, expiresAt: Date): void {
    this._resetToken = token;
    this._resetTokenExpiry = expiresAt;
    this._updatedAt = new Date();
  }

  /**
   * @method clearResetToken
   * @description Clears any active reset token.
   */
  clearResetToken(): void {
    this._resetToken = undefined;
    this._resetTokenExpiry = undefined;
    this._updatedAt = new Date();
  }

  /**
   * @method isResetTokenExpired
   * @description Returns true if the current reset token is expired or missing.
   */
  isResetTokenExpired(): boolean {
    if (!this._resetToken || !this._resetTokenExpiry) {
      return true;
    }
    return this._resetTokenExpiry.getTime() < Date.now();
  }

  /**
   * @method toJSON
   * @description Returns a safe public representation. NEVER includes passwordHash,
   *   mfaSecret, emailVerifyToken, inviteToken, or resetToken.
   */
  toJSON(): CustomerUserPublicDto {
    return {
      id: this._id,
      accountId: this._accountId,
      email: this._email,
      firstName: this._firstName,
      lastName: this._lastName,
      roleId: this._roleId,
      roleName: this._roleName,
      roleLevel: this._roleLevel,
      permissions: [...this._permissions],
      isActive: this._isActive,
      isEmailVerified: this._isEmailVerified,
      mfaEnabled: this._mfaEnabled,
      lastLoginAt: this._lastLoginAt ? this._lastLoginAt.toISOString() : null,
      joinedAt: this._joinedAt.toISOString(),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
