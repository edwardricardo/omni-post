/**
 * @file SearchTeamMembersQuery.ts
 * @description Query use case for searching team members by name or email
 *   within an account. Used by the @mention autocomplete endpoint.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { TeamMemberRepository } from "../../domain/repositories/TeamMemberRepository.js";

/**
 * Input DTO for searching team members.
 */
export interface SearchTeamMembersInput {
  readonly accountId: string;
  readonly query: string;
  readonly limit?: number;
}

/**
 * Single team member match result.
 */
export interface TeamMemberSearchResult {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

/**
 * @class SearchTeamMembersQuery
 * @description Searches team members by name or email within an account.
 *   Returns up to `limit` (default 10) active members matching the query.
 */
export class SearchTeamMembersQuery implements UseCase<
  SearchTeamMembersInput,
  TeamMemberSearchResult[],
  UseCaseError
> {
  constructor(private readonly teamMemberRepo: TeamMemberRepository) {}

  /**
   * @method execute
   * @description Fetches all active members for the account and filters client-side
   *   by case-insensitive name or email match. Returns top N results.
   * @param input - Account ID, search query string, and optional limit
   * @returns Result containing matched members on success
   */
  async execute(
    input: SearchTeamMembersInput
  ): Promise<Result<TeamMemberSearchResult[], UseCaseError>> {
    const limit = input.limit ?? 10;
    const queryLower = input.query.toLowerCase().trim();

    if (!input.accountId) {
      return err(new UseCaseError("Account ID is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const membersResult = await this.teamMemberRepo.findByAccount(input.accountId);

    if (!membersResult.ok) {
      return err(
        new UseCaseError(
          "Failed to search team members",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          membersResult.error
        )
      );
    }

    const members = membersResult.value;

    // Filter active members matching name or email, limited to `limit` results
    const matches: TeamMemberSearchResult[] = [];

    for (const member of members) {
      if (!member.isActive) continue;

      if (queryLower.length === 0) {
        // Empty query returns all active members up to limit
        matches.push({
          id: member.id.value,
          displayName: member.name,
          email: member.email,
        });
      } else {
        const nameMatch = member.name.toLowerCase().includes(queryLower);
        const emailMatch = member.email.toLowerCase().includes(queryLower);

        if (nameMatch || emailMatch) {
          matches.push({
            id: member.id.value,
            displayName: member.name,
            email: member.email,
          });
        }
      }

      if (matches.length >= limit) break;
    }

    return ok(matches);
  }
}
