/**
 * @file ConfigureOidcUseCase.ts
 * @description Creates or replaces the OIDC SSO configuration for an account.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  OidcConfigurationRepository,
  OidcConfigurationData,
} from "@core/domain/repositories/OidcConfigurationRepository.js";
import {
  OidcConfiguration,
  type OidcAttributeMapping,
} from "@core/domain/entities/OidcConfiguration.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { randomUUID } from "crypto";

export interface ConfigureOidcInput {
  accountId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  attributeMapping: OidcAttributeMapping;
}

export class ConfigureOidcUseCase implements UseCase<
  ConfigureOidcInput,
  OidcConfigurationData,
  UseCaseError
> {
  constructor(
    private readonly repository: OidcConfigurationRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input via domain entity, then persists the OIDC configuration.
   */
  async execute(input: ConfigureOidcInput): Promise<Result<OidcConfigurationData, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const createResult = OidcConfiguration.create({
      id: randomUUID(),
      accountId: input.accountId,
      issuerUrl: input.issuerUrl,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      ...(input.scopes !== undefined && { scopes: input.scopes }),
      attributeMapping: input.attributeMapping,
    });

    if (!createResult.ok) {
      return err(new UseCaseError(createResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const config = createResult.value;

    const doWork = async (): Promise<Result<OidcConfigurationData, UseCaseError>> => {
      const saveResult = await this.repository.save(config);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save OIDC configuration",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      // Read back the saved config
      const saved = await this.repository.findByAccountId(input.accountId);
      if (!saved) {
        return err(
          new UseCaseError(
            "OIDC configuration not found after save",
            USE_CASE_ERRORS.INTERNAL_ERROR
          )
        );
      }

      return ok(saved);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<OidcConfigurationData, UseCaseError> = err(
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
          "Failed to configure OIDC",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
