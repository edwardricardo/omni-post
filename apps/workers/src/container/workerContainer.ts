/**
 * @file workerContainer.ts
 * @description Composition root for the workers deployable. This is the ONLY
 *   module under apps/workers/src that imports the @infra/prisma singleton;
 *   every worker factory receives PrismaClient by constructor injection from
 *   here (Mark Seemann — "composition root per executable"). The boot-time DB
 *   auth check is re-exported so each worker entry verifies the connection
 *   without reaching for the global itself.
 * @layer infrastructure
 */

import { prisma, verifyDatabaseAuth } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";

/** The shared PrismaClient for the workers process, resolved once here. */
export const workerPrisma: PrismaClient = prisma;

export { verifyDatabaseAuth };
