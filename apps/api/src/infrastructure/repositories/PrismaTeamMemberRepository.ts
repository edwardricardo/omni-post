/**
 * @file PrismaTeamMemberRepository.ts
 * @description Infrastructure adapter implementing TeamMemberRepository port
 *   using Prisma ORM. Maps between Prisma database types and domain entities.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";
import { TeamMemberEntity } from "../../domain/entities/TeamMember.js";
import { TeamMemberId } from "../../domain/value-objects/TeamMemberId.js";
import { TeamRole } from "../../domain/value-objects/TeamRole.js";
import { EntityNotFoundError, type DomainError } from "../../domain/errors/index.js";

/**
 * Raw Prisma row shape for type-safe mapping
 */
interface PrismaTeamMemberRow {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  invitedBy: string | null;
  inviteToken: string | null;
  inviteTokenExpiry: Date | null;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @class PrismaTeamMemberRepository
 * @description Adapter for TeamMemberRepository using Prisma.
 *   Converts between Prisma database records and TeamMemberEntity domain objects.
 */
export class PrismaTeamMemberRepository implements TeamMemberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a team member by their unique identifier.
   * @param id - The TeamMemberId to look up
   * @returns Result containing entity on success, EntityNotFoundError if missing
   */
  async findById(id: TeamMemberId): Promise<Result<TeamMemberEntity, EntityNotFoundError>> {
    try {
      const row = await this.prisma.teamMember.findUnique({
        where: { id: id.value },
      });

      if (!row) {
        return err(new EntityNotFoundError("TeamMember", id.value));
      }

      return ok(this.toDomain(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "TeamMember",
          `${id.value} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByAccountAndEmail
   * @description Finds a team member by account ID and email combination.
   * @param accountId - The account ID
   * @param email - The member's email address
   * @returns Result containing entity on success, EntityNotFoundError if missing
   */
  async findByAccountAndEmail(
    accountId: string,
    email: string
  ): Promise<Result<TeamMemberEntity, EntityNotFoundError>> {
    try {
      const row = await this.prisma.teamMember.findUnique({
        where: {
          accountId_email: {
            accountId,
            email: email.toLowerCase().trim(),
          },
        },
      });

      if (!row) {
        return err(new EntityNotFoundError("TeamMember", `${accountId}:${email}`));
      }

      return ok(this.toDomain(row));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "TeamMember",
          `${accountId}:${email} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByAccount
   * @description Retrieves all team members for a given account.
   * @param accountId - The account ID
   * @returns Result containing array of entities on success
   */
  async findByAccount(accountId: string): Promise<Result<TeamMemberEntity[], DomainError>> {
    try {
      const rows = await this.prisma.teamMember.findMany({
        where: { accountId },
        orderBy: { joinedAt: "asc" },
      });

      return ok(rows.map((row) => this.toDomain(row)));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "TeamMember",
          `account:${accountId} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method findByProject
   * @description Retrieves all team members assigned to a given project.
   * @param projectId - The project ID
   * @returns Result containing array of entities on success
   */
  async findByProject(projectId: string): Promise<Result<TeamMemberEntity[], DomainError>> {
    try {
      const rows = await this.prisma.projectMember.findMany({
        where: { projectId },
        include: { member: true },
      });

      return ok(rows.map((row) => this.toDomain(row.member)));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "TeamMember",
          `project:${projectId} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  /**
   * @method save
   * @description Persists a team member (create or update via upsert).
   * @param member - The TeamMemberEntity to save
   * @returns Result<void> on success
   */
  async save(member: TeamMemberEntity): Promise<Result<void, DomainError>> {
    try {
      const data = {
        accountId: member.accountId,
        email: member.email,
        name: member.name,
        role: member.role.value,
        isActive: member.isActive,
        invitedBy: member.invitedBy ?? null,
        inviteToken: member.inviteToken ?? null,
        inviteTokenExpiry: member.inviteTokenExpiry ?? null,
        joinedAt: member.joinedAt,
      };

      await this.prisma.teamMember.upsert({
        where: { id: member.id.value },
        create: {
          id: member.id.value,
          ...data,
        },
        update: {
          name: data.name,
          role: data.role,
          isActive: data.isActive,
          inviteToken: data.inviteToken,
          inviteTokenExpiry: data.inviteTokenExpiry,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "TeamMember",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method delete
   * @description Removes a team member by ID.
   * @param id - The TeamMemberId to delete
   * @returns Result<void> on success
   */
  async delete(id: TeamMemberId): Promise<Result<void, DomainError>> {
    try {
      const exists = await this.prisma.teamMember.findUnique({
        where: { id: id.value },
      });

      if (!exists) {
        return err(new EntityNotFoundError("TeamMember", id.value));
      }

      // Delete project memberships first, then the member
      await this.prisma.$transaction([
        this.prisma.projectMember.deleteMany({
          where: { memberId: id.value },
        }),
        this.prisma.teamMember.delete({
          where: { id: id.value },
        }),
      ]);

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "TeamMember",
          `delete failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to a TeamMemberEntity domain object.
   * @param row - Raw Prisma record
   * @returns Reconstituted TeamMemberEntity
   */
  private toDomain(row: PrismaTeamMemberRow): TeamMemberEntity {
    const roleResult = TeamRole.fromString(row.role);
    // DB should always have valid roles; fall back to MEMBER for safety
    const role = roleResult.ok ? roleResult.value : TeamRole.member();

    return TeamMemberEntity.reconstitute({
      id: TeamMemberId.fromStringUnsafe(row.id),
      accountId: row.accountId,
      email: row.email,
      name: row.name,
      role,
      isActive: row.isActive,
      ...(row.invitedBy !== null && { invitedBy: row.invitedBy }),
      ...(row.inviteToken !== null && { inviteToken: row.inviteToken }),
      ...(row.inviteTokenExpiry !== null && { inviteTokenExpiry: row.inviteTokenExpiry }),
      joinedAt: row.joinedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
