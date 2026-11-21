/**
 * @file firstAdministratorCommand.ts
 * @description The first-administrator command as a function of its arguments, its two streams
 *              and the loader of its composition, so it runs the same in the process and in a
 *              test. It creates the first administrator, or with `--reissue` re-issues the
 *              single-use password of an administrator who has never signed in. It reads its
 *              arguments, then checks that standard output is an interactive terminal, and only
 *              then loads the composition, so `--help`, a usage error and the terminal refusal
 *              read no environment and open no connection; it then checks the database
 *              connection before any use case runs. On success standard output carries one block,
 *              with the single-use password exactly once; a refusal or a failure goes to standard
 *              error as the registry's message for its code, never the error's own message, then,
 *              for a failure, the class and code of each cause, never a cause's message, which can
 *              carry the arguments of a call, a variable's value or the database's address, and
 *              last a line that names the code. Nothing of a use case's result goes to a logger.
 * @layer infrastructure
 */

import { parseArgs } from "node:util";
import {
  AUTH_ERRORS,
  ERROR_CATEGORY,
  PLATFORM_ERRORS,
  RegisteredError,
  isCodedError,
  resolveError,
  type Result,
} from "@shared/types";
import type { UseCase, UseCaseError } from "@core/application/UseCase.js";
import type {
  CreateFirstAdministratorInput,
  CreateFirstAdministratorOutput,
  ReissueAdministratorPasswordInput,
  ReissueAdministratorPasswordOutput,
} from "@core/auth";
import { DEFAULT_LOCKOUT_DURATION_MINUTES } from "../infrastructure/adapters/bruteForceDefaults.js";

/** A stream the command writes text to. */
interface CommandOutput {
  write(text: string): unknown;
}

/** Standard output, which must be a terminal for the password to be written to it. */
interface CommandTerminal extends CommandOutput {
  readonly isTTY?: boolean | undefined;
}

/** The two streams the command writes to. */
export interface CommandStreams {
  readonly stdout: CommandTerminal;
  readonly stderr: CommandOutput;
}

/**
 * What the composition gives the command: its two use cases, the check of its database connection
 * and the release of that connection.
 */
export interface FirstAdministratorCommand {
  readonly createFirstAdministrator: UseCase<
    CreateFirstAdministratorInput,
    CreateFirstAdministratorOutput,
    UseCaseError
  >;
  readonly reissueAdministratorPassword: UseCase<
    ReissueAdministratorPasswordInput,
    ReissueAdministratorPasswordOutput,
    UseCaseError
  >;
  /** Reaches the database and rejects when no connection can be opened; it writes nothing. */
  connect(): Promise<void>;
  /** Releases the database connection, so the process ends by itself. */
  close(): Promise<void>;
}

/** Builds the composition; called only once the arguments and the terminal are right. */
export type FirstAdministratorCommandLoader = () => Promise<FirstAdministratorCommand>;

/** The command's exit codes. */
const EXIT = {
  OK: 0,
  REFUSED_OR_FAILED: 1,
  USAGE: 2,
} as const;

const USAGE =
  "Usage: create-first-admin --email <address> [--reissue]\nRun it with --help for what it does.\n";

const HELP = `Usage: create-first-admin --email <address> [--reissue]

Creates the first administrator of a database that has none, with the SUPER_ADMIN role, and
prints the single-use password the administrator signs in with. The administrator is named after
the e-mail's local part and is marked to change that password (mustChangePassword): sign in with
it and change it at once.

Without --reissue it creates an administrator once: once an administrator exists, every
later run without --reissue is refused.

With --reissue it prints a new single-use password for the administrator with that e-mail
instead, for when its single-use password was never seen. It serves any active administrator,
not only the first, who has never signed in and is still marked to change the password. The new
password replaces the old one, which no longer works, every session of the administrator is
ended, and the mark stays, so the new password too must be changed at the first sign-in. Any
other administrator is refused and nothing is changed; a deactivated one must be reactivated
first.

Options:
  --email <address>  The e-mail of the administrator to create, or whose single-use password
                     to re-issue.
  --reissue          Re-issues the single-use password instead of creating an administrator.
  --help             Prints this text.

The terminal:
  Its standard output must be an interactive terminal: the single-use password is shown there
  once and is written to no log, so the command refuses to run when its output goes to a pipe or
  a file.

Where it runs:
  In the API's environment, the one the API starts with. In a container of the API's image,
  attached to a terminal (for example with docker exec -it), from its working directory /app:
    /nodejs/bin/node dist/cli/createFirstAdministrator.js --email <address>
  From a checkout, in apps/api, from source or from the build:
    pnpm --silent create-first-admin --email <address>
    pnpm --silent create-first-admin:dist --email <address>

Exit codes:
  0  The administrator was created, or its single-use password was re-issued.
  1  Refused (an administrator exists, or the administration role is held; with --reissue, no
     administrator has the e-mail, it has signed in, it is not marked, it is deactivated, or it
     changed between the read and the write) or failed.
  2  The arguments are wrong, the sign-in refuses the e-mail, or standard output is not a terminal.

A refusal or a failure ends with a line Code: <CODE>, the code to quote when it is reported.
`;

/** How deep the chain of causes is followed on standard error. */
const MAX_CAUSES = 5;

/** A code is printed only in this shape; the address, a hash and a password never have it. */
const PRINTABLE_CODE = /^[A-Z0-9_]{1,64}$/;

/** What the arguments ask for. */
type ParsedArguments =
  | { readonly kind: "help" }
  | { readonly kind: "create" | "reissue"; readonly email: string }
  | { readonly kind: "usage"; readonly refusal: RegisteredError };

/** The two modes a run executes once its arguments and its terminal are right. */
type RunMode = Extract<ParsedArguments, { readonly email: string }>;

/**
 * Reads the arguments with `parseArgs` in strict mode. A parse error is reported by a fixed
 * refusal chosen by its code, never by its message, which echoes the argument.
 */
function parseCommandArguments(args: readonly string[]): ParsedArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        email: { type: "string" },
        reissue: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return {
      kind: "usage",
      refusal:
        code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"
          ? RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_OPTION_VALUE_INVALID)
          : RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_OPTION_UNKNOWN),
    };
  }
  if (parsed.values.help === true) {
    return { kind: "help" };
  }
  const emailTokens = parsed.tokens.filter(
    (token) => token.kind === "option" && token.name === "email"
  );
  if (emailTokens.length > 1) {
    return {
      kind: "usage",
      refusal: RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_EMAIL_REPEATED),
    };
  }
  const reissue = parsed.values.reissue === true;
  const email = parsed.values.email;
  if (email === undefined) {
    return {
      kind: "usage",
      refusal: reissue
        ? RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_EMAIL_MISSING_FOR_REISSUE)
        : RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_EMAIL_MISSING),
    };
  }
  if (email === "") {
    return {
      kind: "usage",
      refusal: RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_OPTION_VALUE_INVALID),
    };
  }
  return { kind: reissue ? "reissue" : "create", email };
}

/** A raised value as the cause of the error that reports it: only an `Error` is one. */
function asCause(raised: unknown): Error | undefined {
  return raised instanceof Error ? raised : undefined;
}

/**
 * The lines that name each cause of an error by its class and, when it has one of a printable
 * shape, its code. A cause's message is never included.
 */
function causeLines(error: unknown): string[] {
  const lines: string[] = [];
  let cause: unknown = error;
  while (cause instanceof Error && lines.length < MAX_CAUSES) {
    const code = "code" in cause ? cause.code : undefined;
    const className = cause.constructor.name;
    lines.push(
      typeof code === "string" && PRINTABLE_CODE.test(code)
        ? `Cause: ${className}, code ${code}\n`
        : `Cause: ${className}\n`
    );
    cause = cause.cause;
  }
  return lines;
}

/**
 * Writes a refusal or a failure on standard error and returns its exit code, both read from the
 * registry's entry for the error's code, never from the error's own message: a validation failure
 * is its message and then `usage`, with exit code 2; a conflict or a not-found is `Refused: ` and
 * its message, with exit code 1; anything else is `Failed: `, its message and the class and code of
 * each cause, with exit code 1. The last line names the code, so a ticket can quote it.
 */
function writeFailure(error: unknown, usage: string, streams: CommandStreams): number {
  const { definition, message } = resolveError(error);
  const codeLine = `Code: ${definition.code}\n`;
  switch (definition.category) {
    case ERROR_CATEGORY.VALIDATION:
      streams.stderr.write(`${message}\n${usage}${codeLine}`);
      return EXIT.USAGE;
    case ERROR_CATEGORY.CONFLICT:
    case ERROR_CATEGORY.NOT_FOUND:
      streams.stderr.write(`Refused: ${message}\n${codeLine}`);
      return EXIT.REFUSED_OR_FAILED;
    default: {
      const cause = error instanceof Error ? error.cause : undefined;
      streams.stderr.write([`Failed: ${message}\n`, ...causeLines(cause), codeLine].join(""));
      return EXIT.REFUSED_OR_FAILED;
    }
  }
}

/**
 * The failure of the setup as the operator reads it: a refused environment as itself, since it
 * names the refused variables and never a value, and anything else as the setup's failure, with
 * what was raised as its cause.
 */
function setupFailure(raised: unknown): unknown {
  if (isCodedError(raised) && raised.code === PLATFORM_ERRORS.ENV_VARIABLES_REFUSED.code) {
    return raised;
  }
  return RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_SETUP_FAILED, {
    cause: asCause(raised),
  });
}

/** What each mode reports when its use case gives no answer, so its outcome is not known. */
function noAnswer(kind: RunMode["kind"], cause: Error | undefined): RegisteredError {
  return kind === "reissue"
    ? RegisteredError.of(AUTH_ERRORS.PASSWORD_REISSUE_NO_ANSWER, { cause })
    : RegisteredError.of(AUTH_ERRORS.FIRST_ADMINISTRATOR_NO_ANSWER, { cause });
}

/** The block written when the administrator is created; the password appears in it once. */
function createdBlock(created: CreateFirstAdministratorOutput): string {
  return [
    "The first administrator was created.",
    "",
    `  E-mail:              ${created.email}`,
    `  Single-use password: ${created.password}`,
    "",
    "The password is shown this once and is stored nowhere: only its hash is kept.",
    "Sign in with it now and change it at once.",
    "",
  ].join("\n");
}

/**
 * What a re-issue does not change: a lock that failed sign-ins set on the address. The command
 * opens no Redis connection, so it neither reads nor clears that lock. The minutes are the default
 * the brute-force adapter applies as the API composes it, read from the module both share, which
 * imports nothing: the adapter's own module loads the logger and the API's environment, and the
 * command loads nothing before its arguments and its terminal are right.
 */
const LOCK_LINE = `If the sign-in answers that the account is locked, the lock that failed sign-ins set is still in place: it ends by itself within ${String(DEFAULT_LOCKOUT_DURATION_MINUTES)} minutes.`;

/** The block written when the password is re-issued; the password appears in it once. */
function reissuedBlock(reissued: ReissueAdministratorPasswordOutput): string {
  return [
    "A new single-use password was issued.",
    "",
    `  E-mail:              ${reissued.email}`,
    `  Single-use password: ${reissued.password}`,
    "",
    "The password is shown this once and is stored nowhere: only its hash is kept.",
    "The previous single-use password no longer works, and every session of this administrator was ended.",
    "Sign in with it now and change it at once.",
    LOCK_LINE,
    "",
  ].join("\n");
}

/**
 * Writes the outcome of a use case and returns its exit code: the block on standard output on
 * success, otherwise the refusal or the failure on standard error.
 */
function report<T>(
  outcome: Result<T, UseCaseError>,
  block: (value: T) => string,
  streams: CommandStreams
): number {
  if (outcome.ok) {
    streams.stdout.write(block(outcome.value));
    return EXIT.OK;
  }
  return writeFailure(outcome.error, USAGE, streams);
}

/**
 * Checks the database connection, then runs the mode's use case and writes its outcome; a
 * connection that cannot be opened runs no use case.
 */
async function runConnected(
  mode: RunMode,
  command: FirstAdministratorCommand,
  streams: CommandStreams
): Promise<number> {
  try {
    await command.connect();
  } catch (error: unknown) {
    return writeFailure(
      RegisteredError.of(PLATFORM_ERRORS.DATABASE_UNREACHABLE, { cause: asCause(error) }),
      USAGE,
      streams
    );
  }
  try {
    return mode.kind === "reissue"
      ? report(
          await command.reissueAdministratorPassword.execute({ email: mode.email }),
          reissuedBlock,
          streams
        )
      : report(
          await command.createFirstAdministrator.execute({ email: mode.email }),
          createdBlock,
          streams
        );
  } catch (error: unknown) {
    return writeFailure(noAnswer(mode.kind, asCause(error)), USAGE, streams);
  }
}

/**
 * @function runFirstAdministratorCommand
 * @description Runs the first-administrator command: reads the arguments, refuses when standard
 *   output is not a terminal, then loads the composition, checks the database connection, runs
 *   the creation or, with `--reissue`, the re-issue with the e-mail, writes the outcome and
 *   releases the connection. Every refusal and failure is worded by the registry's entry for its
 *   code and ends with a line that names the code.
 * @param args - The command's arguments, without the runtime and the script
 * @param streams - Standard output, which must be a terminal, and standard error
 * @param load - Builds the composition; it is not called on `--help`, a usage error or the
 *   terminal refusal
 * @returns 0 when the administrator was created or its password re-issued; 1 when the use case
 *   refused or something failed, the environment and the database connection included; 2 for
 *   wrong arguments, an e-mail the sign-in refuses, or a standard output that is not a terminal
 */
export async function runFirstAdministratorCommand(
  args: readonly string[],
  streams: CommandStreams,
  load: FirstAdministratorCommandLoader
): Promise<number> {
  const parsed = parseCommandArguments(args);
  if (parsed.kind === "help") {
    streams.stdout.write(HELP);
    return EXIT.OK;
  }
  if (parsed.kind === "usage") {
    return writeFailure(parsed.refusal, USAGE, streams);
  }
  if (streams.stdout.isTTY !== true) {
    // The terminal refusal is not about the arguments, so the usage does not follow it.
    return writeFailure(
      RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_OUTPUT_NOT_A_TERMINAL),
      "",
      streams
    );
  }

  let command: FirstAdministratorCommand;
  try {
    command = await load();
  } catch (error: unknown) {
    return writeFailure(setupFailure(error), USAGE, streams);
  }

  const exitCode = await runConnected(parsed, command, streams);

  try {
    await command.close();
  } catch (error: unknown) {
    // Reported after the outcome, whose exit code stands: only the release failed.
    writeFailure(
      RegisteredError.of(AUTH_ERRORS.FIRST_ADMIN_COMMAND_CLOSE_FAILED, { cause: asCause(error) }),
      USAGE,
      streams
    );
  }
  return exitCode;
}
