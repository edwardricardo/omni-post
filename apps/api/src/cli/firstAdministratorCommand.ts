/**
 * @file firstAdministratorCommand.ts
 * @description The first-administrator command as a function of its arguments, its two streams
 *              and the loader of its composition, so it runs the same in the process and in a
 *              test. It creates the first administrator, or with `--reissue` re-issues the
 *              single-use password of an administrator who has never signed in. It reads its
 *              arguments, then checks that standard output is an interactive terminal, and only
 *              then loads the composition, so `--help`, a usage error and the terminal refusal
 *              read no environment and open no connection. On success standard output carries
 *              one block, with the single-use password exactly once; a refusal or a failure goes
 *              to standard error as the use case's message and, for a failure, the class and code
 *              of each cause, never a cause's message, which can carry the arguments of a call.
 *              Nothing of a use case's result goes to a logger.
 * @layer infrastructure
 */

import { parseArgs } from "node:util";
import type { Result } from "@shared/types";
import type { UseCase, UseCaseError, UseCaseErrorCode } from "@core/application/UseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  CreateFirstAdministratorInput,
  CreateFirstAdministratorOutput,
  ReissueAdministratorPasswordInput,
  ReissueAdministratorPasswordOutput,
} from "@core/auth";

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

/** What the composition gives the command: its two use cases and the release of its connection. */
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
instead, for when the first administrator's password was never seen: only for an administrator
who has never signed in and is still marked to change the password. The new password replaces
the old one, which no longer works, every session of the administrator is ended, and the mark
stays, so the new password too must be changed at the first sign-in. Any other administrator is
refused and nothing is changed.

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
     administrator has the e-mail, it has signed in, or it is not marked) or failed.
  2  The arguments are wrong, the sign-in refuses the e-mail, or standard output is not a terminal.
`;

const REASONS = {
  missing: "The e-mail of the administrator to create is required.",
  missingForReissue: "The e-mail of the administrator whose password to re-issue is required.",
  value:
    "--email takes the administrator's address as its value, and --reissue and --help take none.",
  unknown: "This command takes only --email <address>, --reissue and --help.",
  repeated: "--email is given more than once.",
} as const;

const TERMINAL_REFUSAL =
  "This command prints a single-use password, so it runs only in an interactive terminal: its standard output is not a terminal, and the password would be kept wherever that output goes. Run it again with its output on a terminal.\n";

const FAILURES = {
  load: "the command could not be set up in this environment; it must run in the API's environment.",
  close: "Closing the database connection failed.",
} as const;

/** What each mode reports when its use case gives no answer, so its outcome is not known. */
const NO_ANSWER = {
  create:
    "creating the first administrator stopped without an answer, so whether it was created is not known: check whether an administrator exists before running it again, and when one exists whose password nobody saw, run this command with --reissue and the same --email.",
  reissue:
    "re-issuing the single-use password stopped without an answer, so whether it was replaced is not known: run this command again with --reissue and the same --email.",
} as const;

/** How deep the chain of causes is followed on standard error. */
const MAX_CAUSES = 5;

/** A code is printed only in this shape; the address, a hash and a password never have it. */
const PRINTABLE_CODE = /^[A-Z0-9_]{1,64}$/;

/** What the arguments ask for. */
type ParsedArguments =
  | { readonly kind: "help" }
  | { readonly kind: "create" | "reissue"; readonly email: string }
  | { readonly kind: "usage"; readonly reason: string };

/**
 * Reads the arguments with `parseArgs` in strict mode. A parse error is reported by a fixed
 * reason chosen by its code, never by its message, which echoes the argument.
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
      reason: code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" ? REASONS.value : REASONS.unknown,
    };
  }
  if (parsed.values.help === true) {
    return { kind: "help" };
  }
  const emailTokens = parsed.tokens.filter(
    (token) => token.kind === "option" && token.name === "email"
  );
  if (emailTokens.length > 1) {
    return { kind: "usage", reason: REASONS.repeated };
  }
  const reissue = parsed.values.reissue === true;
  const email = parsed.values.email;
  if (email === undefined) {
    return { kind: "usage", reason: reissue ? REASONS.missingForReissue : REASONS.missing };
  }
  if (email === "") {
    return { kind: "usage", reason: REASONS.value };
  }
  return { kind: reissue ? "reissue" : "create", email };
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
    "",
  ].join("\n");
}

/**
 * The use-case error codes each mode reports as a refusal: the creation refuses only on a
 * conflict, and the re-issue also when no administrator has the e-mail. Any other code but a
 * validation failure is reported as a failure, with its causes.
 */
const REFUSAL_CODES: Readonly<Record<"create" | "reissue", ReadonlyArray<UseCaseErrorCode>>> = {
  create: [USE_CASE_ERRORS.CONFLICT],
  reissue: [USE_CASE_ERRORS.CONFLICT, USE_CASE_ERRORS.NOT_FOUND],
};

/**
 * Writes the outcome of a use case and returns its exit code: the block on standard output on
 * success, otherwise the message on standard error, as a refusal when its code is one of the
 * mode's refusal codes.
 */
function report<T>(
  outcome: Result<T, UseCaseError>,
  block: (value: T) => string,
  refusalCodes: ReadonlyArray<UseCaseErrorCode>,
  streams: CommandStreams
): number {
  if (outcome.ok) {
    streams.stdout.write(block(outcome.value));
    return EXIT.OK;
  }
  const { error } = outcome;
  if (refusalCodes.some((code) => code === error.code)) {
    streams.stderr.write(`Refused: ${error.message}\n`);
    return EXIT.REFUSED_OR_FAILED;
  }
  if (error.code === USE_CASE_ERRORS.VALIDATION_FAILED) {
    streams.stderr.write(`${error.message}\n${USAGE}`);
    return EXIT.USAGE;
  }
  streams.stderr.write([`Failed: ${error.message}\n`, ...causeLines(error.cause)].join(""));
  return EXIT.REFUSED_OR_FAILED;
}

/**
 * @function runFirstAdministratorCommand
 * @description Runs the first-administrator command: reads the arguments, refuses when standard
 *   output is not a terminal, then loads the composition, runs the creation or, with
 *   `--reissue`, the re-issue with the e-mail, writes the outcome and releases the connection.
 * @param args - The command's arguments, without the runtime and the script
 * @param streams - Standard output, which must be a terminal, and standard error
 * @param load - Builds the composition; it is not called on `--help`, a usage error or the
 *   terminal refusal
 * @returns 0 when the administrator was created or its password re-issued; 1 when the use case
 *   refused or something failed; 2 for wrong arguments, an e-mail the sign-in refuses, or a
 *   standard output that is not a terminal
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
    streams.stderr.write(`${parsed.reason}\n${USAGE}`);
    return EXIT.USAGE;
  }
  if (streams.stdout.isTTY !== true) {
    streams.stderr.write(TERMINAL_REFUSAL);
    return EXIT.USAGE;
  }

  let command: FirstAdministratorCommand;
  try {
    command = await load();
  } catch (error: unknown) {
    streams.stderr.write([`Failed: ${FAILURES.load}\n`, ...causeLines(error)].join(""));
    return EXIT.REFUSED_OR_FAILED;
  }

  let exitCode: number;
  try {
    exitCode =
      parsed.kind === "reissue"
        ? report(
            await command.reissueAdministratorPassword.execute({ email: parsed.email }),
            reissuedBlock,
            REFUSAL_CODES.reissue,
            streams
          )
        : report(
            await command.createFirstAdministrator.execute({ email: parsed.email }),
            createdBlock,
            REFUSAL_CODES.create,
            streams
          );
  } catch (error: unknown) {
    streams.stderr.write([`Failed: ${NO_ANSWER[parsed.kind]}\n`, ...causeLines(error)].join(""));
    exitCode = EXIT.REFUSED_OR_FAILED;
  }

  try {
    await command.close();
  } catch (error: unknown) {
    streams.stderr.write([`${FAILURES.close}\n`, ...causeLines(error)].join(""));
  }
  return exitCode;
}
