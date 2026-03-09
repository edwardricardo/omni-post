/**
 * @file TeamMemberRepository.ts
 * @description Port interface for TeamMember persistence.
 *   Defines the contract that infrastructure adapters must fulfill.
 * @layer domain
 */
import type { Result } from "@shared/types";
import type { TeamMemberEntity } from "../entities/TeamMember.js";
import type { TeamMemberId } from "../value-objects/TeamMemberId.js";
import type { DomainError, EntityNotFoundError } from "../errors/index.js";

/**
 * @interface TeamMemberRepository
 * @description Command + query repository port for TeamMember aggregate persistence.
 *   Returns domain objects, never raw Prisma types.
 */
export interface TeamMemberRepository {
  /**
   * @method findById
   * @description Finds a team member by their unique identifier.
   * @param id - The TeamMemberId to look up
   * @returns Result containing the entity on success, EntityNotFoundError if not found
   */
  findById(id: TeamMemberId): Promise<Result<TeamMemberEntity, EntityNotFoundError>>;

  /**
   * @method findByAccountAndEmail
   * @description Finds a team member by account ID and email combination.
   * @param accountId - The account ID
   * @param email - The member's email address
   * @returns Result containing the entity on success, EntityNotFoundError if not found
   */
  findByAccountAndEmail(
    accountId: string,
    email: string
  ): Promise<Result<TeamMemberEntity, EntityNotFoundError>>;

  /**
   * @method findByAccount
   * @description Retrieves all team members for a given account.
   * @param accountId - The account ID
   * @returns Result containing an array of entities on success
   */
  findByAccount(accountId: string): Promise<Result<TeamMemberEntity[], DomainError>>;

  /**
   * @method findByProject
   * @description Retrieves all team members assigned to a given project.
   * @param projectId - The project ID
   * @returns Result containing an array of entities on success
   */
  findByProject(projectId: string): Promise<Result<TeamMemberEntity[], DomainError>>;

  /**
   * @method save
   * @description Persists a team member (create or update).
   * @param member - The TeamMemberEntity to save
   * @returns Result<void> on success
   */
  save(member: TeamMemberEntity): Promise<Result<void, DomainError>>;

  /**
   * @method delete
   * @description Removes a team member by ID.
   * @param id - The TeamMemberId to delete
   * @returns Result<void> on success
   */
  delete(id: TeamMemberId): Promise<Result<void, DomainError>>;
}
