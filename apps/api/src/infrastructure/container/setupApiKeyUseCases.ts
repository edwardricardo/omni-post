/**
 * @file setupApiKeyUseCases.ts
 * @description Registers all API key use cases in the DI container.
 *              Extracted from setupUseCases.ts for domain-based modularization.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { ApiKeyRepository } from "../../domain/repositories/ApiKeyRepository.js";
import {
  CreateApiKeyUseCase,
  ValidateApiKeyUseCase,
  ListApiKeysUseCase,
  RotateApiKeyUseCase,
  DeactivateApiKeyUseCase,
} from "../../application/apiKeys/index.js";

/**
 * Register all API key use cases in the container
 */
export function setupApiKeyUseCases(container: Container): void {
  // Register API Key Use Cases
  container.register<CreateApiKeyUseCase>(
    TOKENS.CreateApiKeyUseCase,
    () => new CreateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<ValidateApiKeyUseCase>(
    TOKENS.ValidateApiKeyUseCase,
    () => new ValidateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<ListApiKeysUseCase>(
    TOKENS.ListApiKeysUseCase,
    () => new ListApiKeysUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<RotateApiKeyUseCase>(
    TOKENS.RotateApiKeyUseCase,
    () => new RotateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<DeactivateApiKeyUseCase>(
    TOKENS.DeactivateApiKeyUseCase,
    () => new DeactivateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
}
