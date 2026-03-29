/**
 * @file LogCrmActivityUseCase.ts
 * @description Creates a CRM activity record for later syncing to the CRM platform.
 *              Uses UoW for transactional persistence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  CrmActivityRepository,
  CrmActivityData,
} from "../../domain/repositories/CrmActivityRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

const VALID_ACTIVITY_TYPES = [
  "POST_PUBLISHED",
  "POST_SCHEDULED",
  "CAMPAIGN_CREATED",
  "CAMPAIGN_COMPLETED",
  "APPROVAL_APPROVED",
] as const;

export interface LogCrmActivityInput {
  accountId: string;
  platform: string;
  type: string;
  title: string;
  description?: string;
  occurredAt: Date;
  contactEmail?: string;
  postId?: string;
  campaignId?: string;
}

export class LogCrmActivityUseCase implements UseCase<
  LogCrmActivityInput,
  CrmActivityData,
  UseCaseError
> {
  constructor(
    private readonly repository: CrmActivityRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates and persists a CRM activity record.
   */
  async execute(input: LogCrmActivityInput): Promise<Result<CrmActivityData, UseCaseError>> {
    const validationError = this.validate(input);
    if (validationError) {
      return err(validationError);
    }

    const doWork = async (): Promise<Result<CrmActivityData, UseCaseError>> => {
      const activity = await this.repository.save({
        accountId: input.accountId,
        platform: input.platform,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        occurredAt: input.occurredAt,
        contactEmail: input.contactEmail ?? null,
        postId: input.postId ?? null,
        campaignId: input.campaignId ?? null,
      });
      return ok(activity);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CrmActivityData, UseCaseError> = err(
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
          "Failed to log CRM activity",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private validate(input: LogCrmActivityInput): UseCaseError | null {
    if (!input.accountId) {
      return new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    if (!input.platform) {
      return new UseCaseError("platform is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    if (!VALID_ACTIVITY_TYPES.includes(input.type as (typeof VALID_ACTIVITY_TYPES)[number])) {
      return new UseCaseError(
        `type must be one of: ${VALID_ACTIVITY_TYPES.join(", ")}`,
        USE_CASE_ERRORS.VALIDATION_FAILED
      );
    }
    if (!input.title || input.title.trim().length === 0) {
      return new UseCaseError("title must not be empty", USE_CASE_ERRORS.VALIDATION_FAILED);
    }
    return null;
  }
}
