/**
 * @file GenerateUTMLinksUseCase.ts
 * @description Application use case that generates UTM-tagged URLs for tracked links.
 *   Loads the TrackedLink aggregate, creates a UTMParameters value object,
 *   sets UTM fields on the link, persists, and returns the resulting UTM URL.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { TrackedLinkId, type TrackedLinkRepository } from "@core/domain/index.js";
import { UTMParameters } from "@core/domain/value-objects/UTMParameters.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Input DTO for generating UTM links
 */
export interface GenerateUTMLinksInput {
  trackedLinkId: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

/**
 * Output DTO with the generated UTM URL
 */
export interface GenerateUTMLinksOutput {
  utmUrl: string;
}

/**
 * @class GenerateUTMLinksUseCase
 * @description Creates UTM parameters for an existing tracked link, persists them,
 *   and returns the full URL with UTM query parameters appended.
 */
export class GenerateUTMLinksUseCase implements UseCase<
  GenerateUTMLinksInput,
  GenerateUTMLinksOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: TrackedLinkRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input, loads TrackedLink, applies UTM parameters, persists, returns URL.
   * @param input - The UTM generation parameters
   * @returns Result<GenerateUTMLinksOutput, UseCaseError>
   */
  async execute(
    input: GenerateUTMLinksInput
  ): Promise<Result<GenerateUTMLinksOutput, UseCaseError>> {
    // Validate tracked link ID
    const linkIdResult = TrackedLinkId.fromString(input.trackedLinkId);
    if (!linkIdResult.ok) {
      return err(
        new UseCaseError(
          `Invalid tracked link ID: ${input.trackedLinkId}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Create UTMParameters value object (validates all fields)
    const utmResult = UTMParameters.create({
      source: input.source,
      medium: input.medium,
      campaign: input.campaign,
      ...(input.content !== undefined && { content: input.content }),
      ...(input.term !== undefined && { term: input.term }),
    });

    if (!utmResult.ok) {
      return err(
        new UseCaseError(
          utmResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          utmResult.error
        )
      );
    }

    const linkId = linkIdResult.value;
    const utm = utmResult.value;

    const doWork = async (): Promise<Result<GenerateUTMLinksOutput, UseCaseError>> => {
      const findResult = await this.repository.findById(linkId);
      if (!findResult.ok) {
        return err(
          new UseCaseError(
            `Tracked link not found: ${input.trackedLinkId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            findResult.error
          )
        );
      }

      const link = findResult.value;
      link.setUTMParameters(utm);

      const saveResult = await this.repository.save(link);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save tracked link with UTM parameters",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({ utmUrl: link.getUTMUrl() });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<GenerateUTMLinksOutput, UseCaseError> = ok({
          utmUrl: "",
        }) as Result<GenerateUTMLinksOutput, UseCaseError>;
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to generate UTM links",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
