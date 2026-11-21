/**
 * @file firstAdministratorProcess.ts
 * @description What the first-administrator command's entry loads once its arguments and its
 *              terminal are right: the API's typed env module, which validates the environment
 *              and refuses to go on when it is not the API's, and the composition of both modes on
 *              the Prisma singleton, with the check and the release of the singleton's connection.
 * @layer infrastructure
 */

import "../../config/env.js";
import { prisma } from "@infra/prisma";
import type { FirstAdministratorCommand } from "../../cli/firstAdministratorCommand.js";
import {
  composeCreateFirstAdministrator,
  composeReissueAdministratorPassword,
} from "./firstAdministratorComposition.js";

/**
 * @function openFirstAdministratorCommand
 * @description Builds the command's two use cases on the Prisma singleton; building them opens
 *   no connection, and a run uses one of them. The check of the connection is a `SELECT 1`, which
 *   reads no table: under the driver adapter `$connect()` only builds the pool and resolves with no
 *   database listening, so a query is the cheapest step that opens a connection. The singleton is
 *   released with `$disconnect` and not through `closeDatabaseConnections`, which writes a line to
 *   standard output.
 * @returns The two use cases, the check of the database connection and its release
 */
export function openFirstAdministratorCommand(): FirstAdministratorCommand {
  return {
    createFirstAdministrator: composeCreateFirstAdministrator(prisma),
    reissueAdministratorPassword: composeReissueAdministratorPassword(prisma),
    connect: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    close: () => prisma.$disconnect(),
  };
}
