/**
 * @file UpsertBrandKitUseCase.ts
 * @description Creates or updates the brand kit configuration for an account.
 *              Enforces validation: hex colors must be #RRGGBB format.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  type BrandKitRepository,
  type BrandKitData,
} from "@core/domain/repositories/BrandKitRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export interface UpsertBrandKitInput {
  accountId: string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
  logoStorageKey?: string | null;
  fontPrimary?: string | null;
  fontSecondary?: string | null;
}

export class UpsertBrandKitUseCase implements UseCase<
  UpsertBrandKitInput,
  BrandKitData,
  UseCaseError
> {
  constructor(
    private readonly repository: BrandKitRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates and upserts the brand kit. One brand kit per account (unique constraint).
   */
  async execute(input: UpsertBrandKitInput): Promise<Result<BrandKitData, UseCaseError>> {
    const validationError = this.validate(input);
    if (validationError) {
      return err(validationError);
    }

    const doWork = async (): Promise<Result<BrandKitData, UseCaseError>> => {
      const data = await this.repository.upsert({
        accountId: input.accountId,
        primaryColor: input.primaryColor ?? null,
        secondaryColor: input.secondaryColor ?? null,
        accentColor: input.accentColor ?? null,
        logoUrl: input.logoUrl ?? null,
        logoStorageKey: input.logoStorageKey ?? null,
        fontPrimary: input.fontPrimary ?? null,
        fontSecondary: input.fontSecondary ?? null,
      });

      return ok(data);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<BrandKitData, UseCaseError> = err(
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
          "Failed to upsert brand kit",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private validate(input: UpsertBrandKitInput): UseCaseError | null {
    if (!input.accountId) {
      return new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED);
    }

    const colorFields = [
      { name: "primaryColor", value: input.primaryColor },
      { name: "secondaryColor", value: input.secondaryColor },
      { name: "accentColor", value: input.accentColor },
    ] as const;

    for (const field of colorFields) {
      if (field.value !== undefined && field.value !== null && !HEX_COLOR_REGEX.test(field.value)) {
        return new UseCaseError(
          `${field.name} must be a valid hex color (#RRGGBB format)`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        );
      }
    }

    return null;
  }
}
