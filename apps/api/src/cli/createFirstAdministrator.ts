/**
 * @file createFirstAdministrator.ts
 * @description The process entry of the first-administrator command: it hands its arguments and
 *              its two streams to `runFirstAdministratorCommand` and ends with the exit code it
 *              returns. The composition, which reads the API's typed env module and imports the
 *              database client, is imported only once the arguments and the terminal are right.
 *              The command starts no tracing: it serves no request and its only output is the
 *              operator's terminal. The exit code is set, not forced, so the process ends by
 *              itself once the database connection is released.
 * @layer infrastructure
 */

import { runFirstAdministratorCommand } from "./firstAdministratorCommand.js";

process.exitCode = await runFirstAdministratorCommand(
  process.argv.slice(2),
  { stdout: process.stdout, stderr: process.stderr },
  async () => {
    const { openFirstAdministratorCommand } =
      await import("../infrastructure/container/firstAdministratorProcess.js");
    return openFirstAdministratorCommand();
  }
);
