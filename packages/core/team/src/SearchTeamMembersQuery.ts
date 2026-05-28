/**
 * @file SearchTeamMembersQuery.ts
 * @description Query use case for searching team members by name or email
 *   within an account. Used by the @mention autocomplete endpoint.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";

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
 * @description Searches active team members (CustomerUsers) by name or email
 *   within an account. Returns up to `limit` (default 10) matching members.
 */
export class SearchTeamMembersQuery implements UseCase<
  SearchTeamMembersInput,
  TeamMemberSearchResult[],
  UseCaseError
> {
  constructor(private readonly customerUserRepo: CustomerUserRepository) {}

  /**
   * @method execute
   * @description Fetches all members for the account and filters client-side by
   *   case-insensitive name or email match. Returns top N active matches.
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

    const users = await this.customerUserRepo.findByAccountId(input.accountId);

    const matches: TeamMemberSearchResult[] = [];

    for (const u of users) {
      if (!u.isActive) continue;

      const displayName = u.fullName;

      if (queryLower.length === 0) {
        matches.push({ id: u.id, displayName, email: u.email });
      } else {
        const nameMatch = displayName.toLowerCase().includes(queryLower);
        const emailMatch = u.email.toLowerCase().includes(queryLower);

        if (nameMatch || emailMatch) {
          matches.push({ id: u.id, displayName, email: u.email });
        }
      }

      if (matches.length >= limit) break;
    }

    return ok(matches);
  }
}
