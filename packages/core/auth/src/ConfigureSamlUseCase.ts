/**
 * @file ConfigureSamlUseCase.ts
 * @description Creates or replaces the SAML SSO configuration for an account.
 *              Generates the SP entityId based on account ID.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  SamlConfigurationRepository,
  SamlConfigurationData,
} from "@core/domain/repositories/SamlConfigurationRepository.js";
import {
  SamlConfiguration,
  type SamlAttributeMapping,
} from "@core/domain/entities/SamlConfiguration.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { randomUUID } from "crypto";

export interface ConfigureSamlInput {
  accountId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: SamlAttributeMapping;
}

export class ConfigureSamlUseCase implements UseCase<
  ConfigureSamlInput,
  SamlConfigurationData,
  UseCaseError
> {
  constructor(
    private readonly repository: SamlConfigurationRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input via domain entity, then persists the SAML configuration.
   *              The SP entityId is generated deterministically as https://omnipost.app/saml/{accountId}.
   */
  async execute(input: ConfigureSamlInput): Promise<Result<SamlConfigurationData, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const entityId = `https://omnipost.app/saml/${input.accountId}`;

    const createResult = SamlConfiguration.create({
      id: randomUUID(),
      accountId: input.accountId,
      entityId,
      idpEntityId: input.idpEntityId,
      idpSsoUrl: input.idpSsoUrl,
      idpCertificate: input.idpCertificate,
      attributeMapping: input.attributeMapping,
    });

    if (!createResult.ok) {
      return err(new UseCaseError(createResult.error.message, USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const config = createResult.value;

    const doWork = async (): Promise<Result<SamlConfigurationData, UseCaseError>> => {
      const saveResult = await this.repository.save(config);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save SAML configuration",
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
            "SAML configuration not found after save",
            USE_CASE_ERRORS.INTERNAL_ERROR
          )
        );
      }

      return ok(saved);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<SamlConfigurationData, UseCaseError> = err(
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
          "Failed to configure SAML",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
