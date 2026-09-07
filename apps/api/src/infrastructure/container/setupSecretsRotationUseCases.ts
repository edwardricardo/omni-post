/**
 * @file setupSecretsRotationUseCases.ts
 * @description DI registrations for the secret-rotation status feature. Registers
 *              the read repository and the read-side query as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import { SecretRotationLogPrismaReadRepository } from "../security/SecretRotationLogPrismaReadRepository.js";
import { GetSecretRotationStatusQuery } from "@core/security/GetSecretRotationStatusQuery.js";

/**
 * @function setupSecretsRotationUseCases
 * @description Registers secret-rotation status repository and read-side query in the container.
 * @param container - DI container
 */
export function setupSecretsRotationUseCases(container: Container): void {
  // The container's client, never the `@infra/prisma` singleton — `setup.ts` applies the tenant
  // guard and the request-scoped GUC binding there.
  //
  // Scope declaration for this admin surface: `secretRotationLog` carries no `accountId`, so it
  // is neither guard-enrolled nor RLS-covered and the swap changes nothing observable today.
  // That is exactly why it is stated: the file stops being a place where an unguarded client is
  // in reach, so a future read of an enrolled model added here fails loudly instead of silently.
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);
  const repo = new SecretRotationLogPrismaReadRepository(prisma);
  container.registerInstance(TOKENS.SecretRotationLogReadRepository, repo);
  container.registerInstance(
    TOKENS.GetSecretRotationStatusQuery,
    new GetSecretRotationStatusQuery(repo)
  );
}
