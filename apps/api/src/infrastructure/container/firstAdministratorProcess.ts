/**
 * @file firstAdministratorProcess.ts
 * @description What the first-administrator command's entry loads once its arguments and its
 *              terminal are right: the API's typed env module, which validates the environment
 *              and refuses to go on when it is not the API's, and the composition on the Prisma
 *              singleton, with the release of the singleton's connection.
 * @layer infrastructure
 */

import "../../config/env.js";
import { prisma } from "@infra/prisma";
import type { FirstAdministratorCommand } from "../../cli/firstAdministratorCommand.js";
import { composeCreateFirstAdministrator } from "./firstAdministratorComposition.js";

/**
 * @function openFirstAdministratorCommand
 * @description Builds the command's use case on the Prisma singleton. The singleton is released
 *   with `$disconnect` and not through `closeDatabaseConnections`, which writes a line to
 *   standard output.
 * @returns The use case and the release of the database connection
 */
export function openFirstAdministratorCommand(): FirstAdministratorCommand {
  return {
    createFirstAdministrator: composeCreateFirstAdministrator(prisma),
    close: () => prisma.$disconnect(),
  };
}
