/**
 * @file GetCrmSyncLogsQuery.ts
 * @description Returns sync logs for a CRM connection. Read-only query, no UoW needed.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CrmConnectionRepository } from "@core/domain/repositories/CrmConnectionRepository.js";
import type {
  CrmSyncLogRepository,
  CrmSyncLogData,
} from "@core/domain/repositories/CrmSyncLogRepository.js";

export interface GetCrmSyncLogsInput {
  accountId: string;
  platform: string;
}

export class GetCrmSyncLogsQuery implements UseCase<
  GetCrmSyncLogsInput,
  CrmSyncLogData[],
  UseCaseError
> {
  constructor(
    private readonly connectionRepo: CrmConnectionRepository,
    private readonly syncLogRepo: CrmSyncLogRepository
  ) {}

  /**
   * @method execute
   * @description Looks up the connection by account+platform and returns its sync logs.
   */
  async execute(input: GetCrmSyncLogsInput): Promise<Result<CrmSyncLogData[], UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.platform) {
      return err(new UseCaseError("platform is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const connection = await this.connectionRepo.findByAccountAndPlatform(
      input.accountId,
      input.platform
    );
    if (!connection) {
      return err(new UseCaseError("CRM connection not found", USE_CASE_ERRORS.NOT_FOUND));
    }

    const logs = await this.syncLogRepo.findByConnectionId(connection.id);
    return ok(logs);
  }
}
