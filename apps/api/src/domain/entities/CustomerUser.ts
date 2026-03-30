/**
 * @file CustomerUser.ts
 * @description Domain entity representing a customer-facing user. Customer users
 *   belong to an Account, authenticate via email/password, and access the client
 *   dashboard (not the admin panel).
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Team role constants matching the Prisma TeamRole enum.
 */
export const CUSTOMER_ROLE = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;

export type CustomerRoleValue = (typeof CUSTOMER_ROLE)[keyof typeof CUSTOMER_ROLE];

/**
 * Properties required to construct a CustomerUser.
 */
export interface CustomerUserProps {
  readonly id: string;
  readonly accountId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: CustomerRoleValue;
  readonly isActive: boolean;
  readonly isEmailVerified: boolean;
  readonly emailVerifyToken?: string;
  readonly emailVerifyExpiry?: Date;
  readonly resetToken?: string;
  readonly resetTokenExpiry?: Date;
  readonly mfaEnabled: boolean;
  readonly mfaSecret?: string;
  readonly lastLoginAt?: Date;
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
  readonly role?: CustomerRoleValue;
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
  readonly role: CustomerRoleValue;
  readonly isActive: boolean;
  readonly isEmailVerified: boolean;
  readonly mfaEnabled: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @class CustomerUser
 * @description Represents a customer-side user with authentication capabilities.
 *   This entity never leaks sensitive fields (passwordHash, mfaSecret, tokens)
 *   through its public toJSON().
 */
export class CustomerUser {
  private _id: string;
  private _accountId: string;
  private _email: string;
  private _passwordHash: string;
  private _firstName: string;
  private _lastName: string;
  private _role: CustomerRoleValue;
  private _isActive: boolean;
  private _isEmailVerified: boolean;
  private _emailVerifyToken: string | undefined;
  private _emailVerifyExpiry: Date | undefined;
  private _resetToken: string | undefined;
  private _resetTokenExpiry: Date | undefined;
  private _mfaEnabled: boolean;
  private _mfaSecret: string | undefined;
  private _lastLoginAt: Date | undefined;
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
    this._role = props.role;
    this._isActive = props.isActive;
    this._isEmailVerified = props.isEmailVerified;
    this._emailVerifyToken = props.emailVerifyToken;
    this._emailVerifyExpiry = props.emailVerifyExpiry;
    this._resetToken = props.resetToken;
    this._resetTokenExpiry = props.resetTokenExpiry;
    this._mfaEnabled = props.mfaEnabled;
    this._mfaSecret = props.mfaSecret;
    this._lastLoginAt = props.lastLoginAt;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    this._deletedAt = props.deletedAt;
  }

  /**
   * @method create
   * @description Factory method: validates email format, non-empty names, and returns
   *   a Result. Does NOT hash the password (that is the application layer's responsibility).
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

    const now = new Date();
    return ok(
      new CustomerUser({
        id: input.id,
        accountId: input.accountId,
        email: trimmedEmail.toLowerCase(),
        passwordHash: input.passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        role: input.role ?? CUSTOMER_ROLE.MEMBER,
        isActive: true,
        isEmailVerified: false,
        mfaEnabled: false,
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
  get role(): CustomerRoleValue {
    return this._role;
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
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get deletedAt(): Date | undefined {
    return this._deletedAt;
  }

  // ---- Domain behaviour ----

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
   * @description Marks the user as inactive (soft disable).
   */
  deactivate(): void {
    this._isActive = false;
    this._updatedAt = new Date();
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
   *   mfaSecret, emailVerifyToken, or resetToken.
   */
  toJSON(): CustomerUserPublicDto {
    return {
      id: this._id,
      accountId: this._accountId,
      email: this._email,
      firstName: this._firstName,
      lastName: this._lastName,
      role: this._role,
      isActive: this._isActive,
      isEmailVerified: this._isEmailVerified,
      mfaEnabled: this._mfaEnabled,
      lastLoginAt: this._lastLoginAt ? this._lastLoginAt.toISOString() : null,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }
}
