/**
 * @file setupSecretsRotationUseCases.ts
 * @description DI registrations for the secret-rotation status feature. Registers
 *              the read repository and the read-side query as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { SecretRotationLogPrismaReadRepository } from "../security/SecretRotationLogPrismaReadRepository.js";
import { GetSecretRotationStatusQuery } from "@core/security/GetSecretRotationStatusQuery.js";

/**
 * @function setupSecretsRotationUseCases
 * @description Registers secret-rotation status repository and read-side query in the container.
 * @param container - DI container
 */
export function setupSecretsRotationUseCases(container: Container): void {
  const repo = new SecretRotationLogPrismaReadRepository(prisma);
  container.registerInstance(TOKENS.SecretRotationLogReadRepository, repo);
  container.registerInstance(
    TOKENS.GetSecretRotationStatusQuery,
    new GetSecretRotationStatusQuery(repo)
  );
}
