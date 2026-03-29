/**
 * @file ConnectCrmUseCase.ts
 * @description Creates or updates a CRM connection from OAuth tokens.
 *              Uses UoW for transactional persistence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  CrmConnectionRepository,
  CrmConnectionData,
} from "../../domain/repositories/CrmConnectionRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

const VALID_PLATFORMS = ["HUBSPOT", "SALESFORCE"] as const;

export interface ConnectCrmInput {
  accountId: string;
  platform: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  portalId?: string;
  instanceUrl?: string;
  sandboxMode?: boolean;
}

export class ConnectCrmUseCase implements UseCase<
  ConnectCrmInput,
  CrmConnectionData,
  UseCaseError
> {
  constructor(
    private readonly repository: CrmConnectionRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input and upserts the CRM connection.
   */
  async execute(input: ConnectCrmInput): Promise<Result<CrmConnectionData, UseCaseError>> {
    const validationError = this.validate(input);
    if (validationError) {
      return err(validationError);
    }

    const doWork = async (): Promise<Result<CrmConnectionData, UseCaseError>> => {
      const data = await this.repository.save({
        accountId: input.accountId,
        platform: input.platform,
        isActive: true,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        portalId: input.portalId ?? null,
        instanceUrl: input.instanceUrl ?? null,
        sandboxMode: input.sandboxMode ?? false,
        syncContacts: true,
        syncActivities: true,
        lastSyncAt: null,
      });
      return ok(data);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CrmConnectionData, UseCaseError> = err(
          new UseCaseError("Transaction not executed", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to connect CRM",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private validate(input: ConnectCrmInput): UseCaseError | null {
    if (!input.accountId) {
      return new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    if (!VALID_PLATFORMS.includes(input.platform as (typeof VALID_PLATFORMS)[number])) {
      return new UseCaseError(
        `platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
        USE_CASE_ERRORS.VALIDATION_FAILED
      );
    }
    if (!input.accessToken || input.accessToken.trim().length === 0) {
      return new UseCaseError("accessToken must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    return null;
  }
}
