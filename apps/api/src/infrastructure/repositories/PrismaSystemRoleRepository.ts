/**
 * @file PrismaSystemRoleRepository.ts
 * @description Prisma adapter implementing `SystemRoleRepository`: writes an administration
 *   system role and its `RolePermission` rows in one nested `role.upsert`, on the Unit of Work's
 *   client when a transaction is open.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient, Prisma } from "@infra/prisma";
import { isUniqueViolationOf } from "@infra/prisma/extensions/constraintViolation.js";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import {
  SystemRoleConflictError,
  type SystemRoleDefinition,
  type SystemRoleRepository,
} from "@core/domain/repositories/SystemRoleRepository.js";

/**
 * The unique constraints of `Role`, as the migrations name them. A concurrent write of the same
 * role raises P2002 on one of them: Prisma runs an upsert that carries nested writes as a read
 * followed by a create, so two runs that both read nothing both create, and the second fails.
 */
const ROLE_UNIQUE_CONSTRAINTS = [
  { index: "Role_pkey", fields: ["id"] },
  { index: "Role_name_key", fields: ["name"] },
] as const;

/**
 * @class PrismaSystemRoleRepository
 * @description Prisma implementation of `SystemRoleRepository`.
 */
export class PrismaSystemRoleRepository implements SystemRoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve the active Unit of Work's transaction client, or the base client. */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * @method save
   * @description Writes the role by its fixed id in one nested `role.upsert`, which Prisma runs
   *   as one transaction. The create branch inserts the row with the definition's permissions;
   *   the update branch sets the definition's fields, deletes every permission the definition
   *   does not hold and inserts the ones it does, skipping those already there. Each of those
   *   two nested operations leaves the same rows whichever runs first, so the outcome does not
   *   depend on an order Prisma does not document. Neither branch sends `isActive`: the write
   *   does not change whether an existing role is active, and a role it creates takes the
   *   column's default, active.
   * @param definition - The role as code defines it
   * @returns Ok when written, Err(SystemRoleConflictError) on a unique violation of the role's id
   *   or name, Err(RepositoryFailureError) whose cause is what the client raised on any other
   *   failure
   */
  async save(
    definition: SystemRoleDefinition
  ): Promise<Result<void, SystemRoleConflictError | RepositoryFailureError>> {
    const fields = {
      name: definition.name,
      description: definition.description,
      level: definition.level,
      isSystem: definition.isSystem,
    };
    const grant = {
      createMany: {
        data: definition.permissions.map((permission) => ({ permission })),
        skipDuplicates: true,
      },
    };
    try {
      await this.getClient().role.upsert({
        where: { id: definition.id },
        create: { id: definition.id, ...fields, permissions: grant },
        update: {
          ...fields,
          permissions: {
            deleteMany: { permission: { notIn: [...definition.permissions] } },
            ...grant,
          },
        },
        select: { id: true },
      });
      return ok(undefined);
    } catch (error: unknown) {
      if (ROLE_UNIQUE_CONSTRAINTS.some((constraint) => isUniqueViolationOf(error, constraint))) {
        return err(new SystemRoleConflictError(error));
      }
      return err(new RepositoryFailureError("Writing a system role failed", error));
    }
  }
}
