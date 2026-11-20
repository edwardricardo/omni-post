/**
 * @file firstAdministratorComposition.ts
 * @description Composition root of the first-administrator command: given a Prisma client, it
 *              builds `CreateFirstAdministratorUseCase` with the administrators' and the system
 *              roles' repositories, the Argon2 hasher, the single-use password generator, the
 *              sign-in's address rule, the shared `SUPER_ADMIN` definition, the audit log and the
 *              Unit of Work; and `ReissueAdministratorPasswordUseCase` with the administrators'
 *              and their sessions' repositories, the audit log, the same hasher and generator and
 *              the Unit of Work. It does not build the API's container: the command needs these
 *              pieces only.
 *
 *              The Unit of Work takes the client it is given, which in the command is the
 *              `prisma` singleton as `@infra/prisma` exports it, without the tenant guard the
 *              API's container wraps its client in; it takes the ambient tenant provider, as the
 *              API's does. That is right here: `Role`, `RolePermission`, `AdminUser`,
 *              `AdminSession` and `AuditLog`, the tables the command writes, are not
 *              tenant-scoped, under neither the guard nor row security. The command binds no
 *              tenant and no system context, so its transaction binds no `app.account_id`: under
 *              a database role that row security binds, as the API's is in production, a query of
 *              a tenant table would read no row, an update or a delete would match none, and an
 *              insert would be refused.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { SUPER_ADMIN_ROLE } from "@infra/prisma/adminSystemRoles.js";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { CreateFirstAdministratorUseCase, ReissueAdministratorPasswordUseCase } from "@core/auth";
import { ambientTenantContextProvider } from "../../security/tenantContext.js";
import { Argon2PasswordHasher } from "../adapters/Argon2PasswordHasher.js";
import { NodeCryptoSingleUsePasswordGenerator } from "../adapters/NodeCryptoSingleUsePasswordGenerator.js";
import { ZodAdministratorSignInAddressRule } from "../adapters/ZodAdministratorSignInAddressRule.js";
import { PrismaAdminSessionRepository } from "../repositories/PrismaAdminSessionRepository.js";
import { PrismaAdminUserRepository } from "../repositories/PrismaAdminUserRepository.js";
import { PrismaAuditLogRepository } from "../repositories/PrismaAuditLogRepository.js";
import { PrismaSystemRoleRepository } from "../repositories/PrismaSystemRoleRepository.js";
import { toSystemRoleDefinition } from "./firstAdministratorRole.js";

/**
 * @function composeCreateFirstAdministrator
 * @description Builds the use case on the given client. Its caller owns the client and releases
 *   its connection.
 * @param prisma - The client every repository and the Unit of Work use
 * @returns The use case, ready to run once
 * @throws Error when the shared role grants a value the `Permission` enum does not hold
 */
export function composeCreateFirstAdministrator(
  prisma: PrismaClient
): CreateFirstAdministratorUseCase {
  return new CreateFirstAdministratorUseCase(
    new PrismaAdminUserRepository(prisma),
    new PrismaSystemRoleRepository(prisma),
    new Argon2PasswordHasher(),
    new NodeCryptoSingleUsePasswordGenerator(),
    new ZodAdministratorSignInAddressRule(),
    toSystemRoleDefinition(SUPER_ADMIN_ROLE),
    new PrismaAuditLogRepository(prisma),
    new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
  );
}

/**
 * @function composeReissueAdministratorPassword
 * @description Builds the re-issue of a single-use password on the given client. Its caller owns
 *   the client and releases its connection.
 * @param prisma - The client every repository and the Unit of Work use
 * @returns The use case, ready to run once
 */
export function composeReissueAdministratorPassword(
  prisma: PrismaClient
): ReissueAdministratorPasswordUseCase {
  return new ReissueAdministratorPasswordUseCase(
    new PrismaAdminUserRepository(prisma),
    new PrismaAdminSessionRepository(prisma),
    new PrismaAuditLogRepository(prisma),
    new Argon2PasswordHasher(),
    new NodeCryptoSingleUsePasswordGenerator(),
    new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
  );
}
