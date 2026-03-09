/**
 * @file TeamRole.ts
 * @description Value object representing a team member's role within an account.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

export const TEAM_ROLE = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;

export type TeamRoleValue = (typeof TEAM_ROLE)[keyof typeof TEAM_ROLE];

const TEAM_PERMISSIONS = {
  READ: "READ",
  WRITE: "WRITE",
  PUBLISH: "PUBLISH",
  APPROVE: "APPROVE",
  MANAGE_MEMBERS: "MANAGE_MEMBERS",
} as const;

export type TeamPermission = (typeof TEAM_PERMISSIONS)[keyof typeof TEAM_PERMISSIONS];

const ROLE_PERMISSIONS: Record<TeamRoleValue, readonly TeamPermission[]> = {
  [TEAM_ROLE.OWNER]: ["READ", "WRITE", "PUBLISH", "APPROVE", "MANAGE_MEMBERS"],
  [TEAM_ROLE.MANAGER]: ["READ", "WRITE", "PUBLISH", "APPROVE", "MANAGE_MEMBERS"],
  [TEAM_ROLE.MEMBER]: ["READ", "WRITE", "PUBLISH"],
  [TEAM_ROLE.VIEWER]: ["READ"],
} as const;

const ROLE_HIERARCHY: Record<TeamRoleValue, number> = {
  [TEAM_ROLE.OWNER]: 4,
  [TEAM_ROLE.MANAGER]: 3,
  [TEAM_ROLE.MEMBER]: 2,
  [TEAM_ROLE.VIEWER]: 1,
};

/**
 * @class TeamRole
 * @description Immutable value object encapsulating role assignment, permissions,
 *   and hierarchy logic for team members within an account.
 */
export class TeamRole {
  private readonly _value: TeamRoleValue;

  private constructor(value: TeamRoleValue) {
    this._value = value;
  }

  /**
   * @method value
   * @description Returns the raw string value of this role.
   */
  get value(): TeamRoleValue {
    return this._value;
  }

  /**
   * @method fromString
   * @description Creates a TeamRole from a string, validating against allowed values.
   * @param value - The role string to parse
   * @returns Result containing TeamRole on success, InvalidValueError on failure
   */
  static fromString(value: string): Result<TeamRole, InvalidValueError> {
    const upper = value.toUpperCase();
    if (!Object.values(TEAM_ROLE).includes(upper as TeamRoleValue)) {
      return err(
        new InvalidValueError(
          "TeamRole",
          value,
          `Invalid role: "${value}". Valid: ${Object.values(TEAM_ROLE).join(", ")}`
        )
      );
    }
    return ok(new TeamRole(upper as TeamRoleValue));
  }

  /** @description Factory for OWNER role */
  static owner(): TeamRole {
    return new TeamRole(TEAM_ROLE.OWNER);
  }

  /** @description Factory for MANAGER role */
  static manager(): TeamRole {
    return new TeamRole(TEAM_ROLE.MANAGER);
  }

  /** @description Factory for MEMBER role */
  static member(): TeamRole {
    return new TeamRole(TEAM_ROLE.MEMBER);
  }

  /** @description Factory for VIEWER role */
  static viewer(): TeamRole {
    return new TeamRole(TEAM_ROLE.VIEWER);
  }

  /**
   * @method hasPermission
   * @description Checks whether this role grants the specified permission.
   * @param permission - The permission to check
   * @returns true if the role includes the permission
   */
  hasPermission(permission: TeamPermission): boolean {
    return ROLE_PERMISSIONS[this._value].includes(permission);
  }

  /**
   * @method canManageRole
   * @description Checks whether this role outranks the target role in the hierarchy.
   * @param targetRole - The role to compare against
   * @returns true if this role is strictly higher
   */
  canManageRole(targetRole: TeamRole): boolean {
    return ROLE_HIERARCHY[this._value] > ROLE_HIERARCHY[targetRole._value];
  }

  /** @description Returns true if this is the OWNER role */
  isOwner(): boolean {
    return this._value === TEAM_ROLE.OWNER;
  }

  /** @description Returns true if this is the MANAGER role */
  isManager(): boolean {
    return this._value === TEAM_ROLE.MANAGER;
  }

  /** @description Returns true if this is the MEMBER role */
  isMember(): boolean {
    return this._value === TEAM_ROLE.MEMBER;
  }

  /** @description Returns true if this is the VIEWER role */
  isViewer(): boolean {
    return this._value === TEAM_ROLE.VIEWER;
  }

  /**
   * @method permissions
   * @description Returns the full list of permissions granted by this role.
   */
  permissions(): readonly TeamPermission[] {
    return ROLE_PERMISSIONS[this._value];
  }

  /**
   * @method equals
   * @description Value-based equality check.
   * @param other - The TeamRole to compare
   * @returns true if both roles have the same value
   */
  equals(other: TeamRole): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }
}
