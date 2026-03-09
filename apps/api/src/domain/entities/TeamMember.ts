/**
 * @file TeamMember.ts
 * @description Domain entity representing a team member within an account.
 *   Encapsulates role management, activation lifecycle, and permission checks.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";
import { TeamMemberId } from "../value-objects/TeamMemberId.js";
import { TeamRole, type TeamRoleValue, type TeamPermission } from "../value-objects/TeamRole.js";

interface TeamMemberProps {
  id: TeamMemberId;
  accountId: string;
  email: string;
  name: string;
  role: TeamRole;
  isActive: boolean;
  invitedBy?: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateTeamMemberParams {
  accountId: string;
  email: string;
  name: string;
  role?: TeamRoleValue;
  invitedBy?: string;
}

/**
 * @class TeamMemberEntity
 * @description Aggregate root for team membership within an account.
 *   All state changes are performed through explicit behavior methods
 *   that enforce business invariants and return Result types.
 */
export class TeamMemberEntity {
  private readonly _props: TeamMemberProps;

  private constructor(props: TeamMemberProps) {
    this._props = props;
  }

  // --- Getters ---

  /** @description Unique identifier for this team member */
  get id(): TeamMemberId {
    return this._props.id;
  }

  /** @description The account this member belongs to */
  get accountId(): string {
    return this._props.accountId;
  }

  /** @description The member's email address (always lowercase) */
  get email(): string {
    return this._props.email;
  }

  /** @description The member's display name */
  get name(): string {
    return this._props.name;
  }

  /** @description The member's current role */
  get role(): TeamRole {
    return this._props.role;
  }

  /** @description Whether this member is currently active */
  get isActive(): boolean {
    return this._props.isActive;
  }

  /** @description ID of the user who invited this member (if any) */
  get invitedBy(): string | undefined {
    return this._props.invitedBy;
  }

  /** @description When this member joined the account */
  get joinedAt(): Date {
    return this._props.joinedAt;
  }

  /** @description When this record was created */
  get createdAt(): Date {
    return this._props.createdAt;
  }

  /** @description When this record was last updated */
  get updatedAt(): Date {
    return this._props.updatedAt;
  }

  // --- Factory ---

  /**
   * @method create
   * @description Creates a new TeamMemberEntity, validating all required fields.
   * @param params - Creation parameters including email, name, accountId, and optional role
   * @returns Result containing the new entity on success, InvalidValueError on validation failure
   */
  static create(params: CreateTeamMemberParams): Result<TeamMemberEntity, InvalidValueError> {
    if (!params.email || !params.email.includes("@")) {
      return err(new InvalidValueError("email", params.email, "Valid email is required"));
    }
    if (!params.name || params.name.trim().length === 0) {
      return err(new InvalidValueError("name", params.name, "Name is required"));
    }
    if (!params.accountId || params.accountId.trim().length === 0) {
      return err(new InvalidValueError("accountId", params.accountId, "Account ID is required"));
    }

    const roleResult = params.role ? TeamRole.fromString(params.role) : ok(TeamRole.member());

    if (!roleResult.ok) {
      return err(new InvalidValueError("role", params.role, roleResult.error.message));
    }

    const now = new Date();
    return ok(
      new TeamMemberEntity({
        id: TeamMemberId.generate(),
        accountId: params.accountId,
        email: params.email.toLowerCase().trim(),
        name: params.name.trim(),
        role: roleResult.value,
        isActive: true,
        ...(params.invitedBy !== undefined && {
          invitedBy: params.invitedBy,
        }),
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  // --- Reconstitution (from persistence) ---

  /**
   * @method reconstitute
   * @description Rebuilds a TeamMemberEntity from persisted data without validation.
   * @param props - The full set of properties from the data store
   * @returns A reconstituted TeamMemberEntity
   */
  static reconstitute(props: TeamMemberProps): TeamMemberEntity {
    return new TeamMemberEntity(props);
  }

  // --- Behavior ---

  /**
   * @method updateRole
   * @description Changes this member's role, enforcing hierarchy constraints.
   *   The changer must outrank both the current and the target role.
   * @param newRole - The role to assign
   * @param changerRole - The role of the user performing the change
   * @returns Result<void> on success, InvariantViolationError if hierarchy is violated
   */
  updateRole(newRole: TeamRole, changerRole: TeamRole): Result<void, InvariantViolationError> {
    if (!changerRole.canManageRole(this._props.role)) {
      return err(
        new InvariantViolationError("Cannot change role of a member with equal or higher role")
      );
    }
    if (!changerRole.canManageRole(newRole)) {
      return err(
        new InvariantViolationError("Cannot assign a role equal to or higher than your own")
      );
    }
    this._props.role = newRole;
    this._props.updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method deactivate
   * @description Marks this member as inactive. Owners cannot be deactivated.
   * @returns Result<void> on success, InvariantViolationError if member is an owner
   */
  deactivate(): Result<void, InvariantViolationError> {
    if (this._props.role.isOwner()) {
      return err(new InvariantViolationError("Cannot deactivate the account owner"));
    }
    this._props.isActive = false;
    this._props.updatedAt = new Date();
    return ok(undefined);
  }

  /**
   * @method reactivate
   * @description Marks this member as active again.
   */
  reactivate(): void {
    this._props.isActive = true;
    this._props.updatedAt = new Date();
  }

  /**
   * @method hasPermission
   * @description Checks if this member has the specified permission via their role.
   * @param permission - The permission to check
   * @returns true if the member's role grants the permission
   */
  hasPermission(permission: TeamPermission): boolean {
    return this._props.role.hasPermission(permission);
  }

  /**
   * @method updateName
   * @description Updates the member's display name.
   * @param name - The new name
   * @returns Result<void> on success, InvalidValueError if name is empty
   */
  updateName(name: string): Result<void, InvalidValueError> {
    if (!name || name.trim().length === 0) {
      return err(new InvalidValueError("name", name, "Name is required"));
    }
    this._props.name = name.trim();
    this._props.updatedAt = new Date();
    return ok(undefined);
  }
}
