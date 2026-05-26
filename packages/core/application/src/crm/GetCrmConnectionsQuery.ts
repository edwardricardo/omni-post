/**
 * @file GetCrmConnectionsQuery.ts
 * @description Returns all CRM connections for an account. Read-only query, no UoW needed.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  CrmConnectionRepository,
  CrmConnectionData,
} from "@core/domain/repositories/CrmConnectionRepository.js";

export interface GetCrmConnectionsInput {
  accountId: string;
}

export class GetCrmConnectionsQuery implements UseCase<
  GetCrmConnectionsInput,
  CrmConnectionData[],
  UseCaseError
> {
  constructor(private readonly repository: CrmConnectionRepository) {}

  /**
   * @method execute
   * @description Lists CRM connections for the given account. Masks sensitive fields.
   */
  async execute(input: GetCrmConnectionsInput): Promise<Result<CrmConnectionData[], UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const connections = await this.repository.findByAccountId(input.accountId);

    // Mask tokens in response
    const masked = connections.map((c) => ({
      ...c,
      accessToken: "***MASKED***",
      refreshToken: c.refreshToken ? "***MASKED***" : null,
    }));

    return ok(masked);
  }
}
