/**
 * @file firstAdministratorCommand.test.ts
 * @description Unit tests for `runFirstAdministratorCommand`, the function the first-administrator
 *   command's entry runs, with its streams and its composition replaced by doubles. They pin the
 *   argument table, `--help`, the refusal when standard output is not a terminal, the check of the
 *   database connection before any use case, the block of a creation and of a re-issue
 *   (`--reissue`), each with the single-use password exactly once on standard output and never on
 *   standard error, every refusal and failure of both modes, worded by the registry's entry for its
 *   code and closed by a `Code:` line, and the exit codes, which follow the code's category; and
 *   that standard error never carries an error's own message or a cause's message, so nothing of
 *   the input, no hash, no password, no variable's value and no database address reaches it even
 *   when an error holds them. The composition is loaded only once the arguments and the terminal
 *   are right.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AUTH_ERRORS, PLATFORM_ERRORS, RegisteredError, err, ok, type Result } from "@shared/types";
import { USE_CASE_ERRORS, UseCaseError } from "@core/application/UseCase.js";
import { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import type {
  CreateFirstAdministratorOutput,
  ReissueAdministratorPasswordOutput,
} from "@core/auth";
import {
  runFirstAdministratorCommand,
  type FirstAdministratorCommand,
} from "../../../src/cli/firstAdministratorCommand.js";
import { DEFAULT_LOCKOUT_DURATION_MINUTES } from "../../../src/infrastructure/adapters/bruteForceDefaults.js";

/** The address as the operator types it, and the form the use case stores and returns. */
const OPERATOR_EMAIL = "  First.Admin@Example.COM ";
const STORED_EMAIL = "first.admin@example.com";
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$Zml4dHVyZQ$Zml4dHVyZS1oYXNo";

/** A value no line of the command may print: a variable's value or a database's address. */
const PLANTED_SECRET = "planted-Secret-Value-q8v3";
const PLANTED_DATABASE_URL = `postgresql://first-admin:${PLANTED_SECRET}@db.internal.example:6543/omnipost`;

const USAGE =
  "Usage: create-first-admin --email <address> [--reissue]\nRun it with --help for what it does.\n";

/** Each argument error's text and the code the command closes it with. */
const REASONS = {
  missing: {
    text: "The e-mail of the administrator to create is required.",
    code: "FIRST_ADMIN_COMMAND_EMAIL_MISSING",
  },
  missingForReissue: {
    text: "The e-mail of the administrator whose password to re-issue is required.",
    code: "FIRST_ADMIN_COMMAND_EMAIL_MISSING_FOR_REISSUE",
  },
  value: {
    text: "--email takes the administrator's address as its value, and --reissue and --help take none.",
    code: "FIRST_ADMIN_COMMAND_OPTION_VALUE_INVALID",
  },
  unknown: {
    text: "This command takes only --email <address>, --reissue and --help.",
    code: "FIRST_ADMIN_COMMAND_OPTION_UNKNOWN",
  },
  repeated: {
    text: "--email is given more than once.",
    code: "FIRST_ADMIN_COMMAND_EMAIL_REPEATED",
  },
} as const;

const NO_ANSWER = {
  create:
    "Failed: creating the first administrator stopped without an answer, so whether it was created is not known: check whether an administrator exists before running it again, and when one exists whose password nobody saw, run this command with --reissue and the same --email.\n",
  reissue:
    "Failed: re-issuing the single-use password stopped without an answer, so whether it was replaced is not known: run this command again with --reissue and the same --email.\n",
} as const;

const TERMINAL_REFUSAL =
  "This command prints a single-use password, so it runs only in an interactive terminal: its standard output is not a terminal, and the password would be kept wherever that output goes. Run it again with its output on a terminal.\nCode: FIRST_ADMIN_COMMAND_OUTPUT_NOT_A_TERMINAL\n";

const DATABASE_UNREACHABLE =
  "Failed: The database cannot be reached: no connection could be opened, and nothing was read or written\n";

/** An obviously fake single-use password. */
function makeSingleUsePassword(): string {
  return "fixture-Single-Use-Password-7k2";
}

/** What the use case returns when it creates the administrator. */
function makeCreated(): CreateFirstAdministratorOutput {
  return {
    id: "admin-uuid-001",
    email: STORED_EMAIL,
    name: "first.admin",
    password: makeSingleUsePassword(),
  };
}

/** The block the command writes on success, line by line. */
function successBlock(password: string): string {
  return [
    "The first administrator was created.",
    "",
    `  E-mail:              ${STORED_EMAIL}`,
    `  Single-use password: ${password}`,
    "",
    "The password is shown this once and is stored nowhere: only its hash is kept.",
    "Sign in with it now and change it at once.",
    "",
  ].join("\n");
}

/** What the re-issue returns when it replaces the password. */
function makeReissued(): ReissueAdministratorPasswordOutput {
  return { id: "admin-uuid-001", email: STORED_EMAIL, password: makeSingleUsePassword() };
}

/** The last line of a re-issue's block: what a lock set by failed sign-ins means for it. */
const LOCK_LINE = `If the sign-in answers that the account is locked, the lock that failed sign-ins set is still in place: it ends by itself within ${String(DEFAULT_LOCKOUT_DURATION_MINUTES)} minutes.`;

/** The block the command writes when it re-issues the password, line by line. */
function reissuedBlock(password: string): string {
  return [
    "A new single-use password was issued.",
    "",
    `  E-mail:              ${STORED_EMAIL}`,
    `  Single-use password: ${password}`,
    "",
    "The password is shown this once and is stored nowhere: only its hash is kept.",
    "The previous single-use password no longer works, and every session of this administrator was ended.",
    "Sign in with it now and change it at once.",
    LOCK_LINE,
    "",
  ].join("\n");
}

/** A stream double that records what is written to it. */
function makeStream(isTTY?: boolean) {
  const chunks: string[] = [];
  return {
    ...(isTTY !== undefined && { isTTY }),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    text: () => chunks.join(""),
  };
}

/**
 * The composition double: a creation that answers `outcome`, a re-issue that succeeds, a
 * connection check that `connectOutcome` ends and a close that `closeOutcome` ends.
 */
function makeCommand(
  outcome: () => Promise<Result<CreateFirstAdministratorOutput, UseCaseError>>,
  closeOutcome: () => Promise<void> = async () => undefined,
  connectOutcome: () => Promise<void> = async () => undefined
) {
  const execute = vi.fn(outcome);
  const reissue = vi.fn(async () => ok(makeReissued()));
  const connect = vi.fn(connectOutcome);
  const close = vi.fn(closeOutcome);
  const command: FirstAdministratorCommand = {
    createFirstAdministrator: { execute },
    reissueAdministratorPassword: { execute: reissue },
    connect,
    close,
  };
  const load = vi.fn(async () => command);
  return { execute, reissue, connect, close, load };
}

/** The composition double of a re-issue: its use case answers `outcome`, the creation is not run. */
function makeReissueCommand(
  outcome: () => Promise<Result<ReissueAdministratorPasswordOutput, UseCaseError>>
) {
  const create = vi.fn(async () => ok(makeCreated()));
  const execute = vi.fn(outcome);
  const connect = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const command: FirstAdministratorCommand = {
    createFirstAdministrator: { execute: create },
    reissueAdministratorPassword: { execute },
    connect,
    close,
  };
  const load = vi.fn(async () => command);
  return { create, execute, connect, close, load };
}

/** A failure of the store whose messages carry the input, the hash and the password. */
function makeLeakyStoreFailure(): Error {
  return Object.assign(
    new Error(
      `insert into "AdminUser" ("email","passwordHash") values ('${OPERATOR_EMAIL}','${PASSWORD_HASH}') -- ${makeSingleUsePassword()}`
    ),
    { code: "P2010" }
  );
}

/** A refused connection whose message names the database's address, its user and its password. */
function makeRefusedConnection(): Error {
  return Object.assign(new Error(`connect ECONNREFUSED ${PLANTED_DATABASE_URL}`), {
    code: "ECONNREFUSED",
  });
}

/** Asserts that a text holds nothing of the input, the hash, the password or a planted value. */
function expectNothingSecret(text: string): void {
  expect(text).not.toContain(OPERATOR_EMAIL.trim());
  expect(text.toLowerCase()).not.toContain("first.admin");
  expect(text).not.toContain(PASSWORD_HASH);
  expect(text).not.toContain(makeSingleUsePassword());
  expect(text).not.toContain(PLANTED_SECRET);
  expect(text).not.toContain("db.internal.example");
  expect(text).not.toContain("6543");
  expect(text).not.toContain("postgresql:");
}

/** Runs the command with a terminal as standard output and the given composition. */
async function runInTerminal(
  args: readonly string[],
  load: () => Promise<FirstAdministratorCommand>
) {
  const stdout = makeStream(true);
  const stderr = makeStream();
  const code = await runFirstAdministratorCommand(args, { stdout, stderr }, load);
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

/** Counts the occurrences of `needle` in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("runFirstAdministratorCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("arguments", () => {
    it.each([
      { args: [], reason: REASONS.missing },
      { args: ["--email"], reason: REASONS.value },
      { args: ["--email", ""], reason: REASONS.value },
      { args: ["--email="], reason: REASONS.value },
      { args: ["--email", "--help"], reason: REASONS.value },
      { args: ["--help=yes"], reason: REASONS.value },
      { args: [OPERATOR_EMAIL], reason: REASONS.unknown },
      { args: ["--name", "first.admin"], reason: REASONS.unknown },
      { args: ["-e", OPERATOR_EMAIL], reason: REASONS.unknown },
      { args: ["--email", OPERATOR_EMAIL, "extra"], reason: REASONS.unknown },
      { args: ["--", "--email", OPERATOR_EMAIL], reason: REASONS.unknown },
      {
        args: ["--email", OPERATOR_EMAIL, "--email", "other@example.com"],
        reason: REASONS.repeated,
      },
      { args: ["--reissue"], reason: REASONS.missingForReissue },
      { args: ["--reissue", "--email", ""], reason: REASONS.value },
      { args: ["--reissue=yes", "--email", OPERATOR_EMAIL], reason: REASONS.value },
      { args: ["--no-reissue", "--email", OPERATOR_EMAIL], reason: REASONS.unknown },
      { args: ["--reissue", "--email", OPERATOR_EMAIL, "extra"], reason: REASONS.unknown },
      {
        args: ["--reissue", "--email", OPERATOR_EMAIL, "--email", "other@example.com"],
        reason: REASONS.repeated,
      },
    ])(
      "refuses with exit code 2, the reason, the usage and the reason's code, echoing no argument, when given $args",
      async ({ args, reason }) => {
        const { load } = makeCommand(async () => ok(makeCreated()));

        const run = await runInTerminal(args, load);

        expect(run).toEqual({
          code: 2,
          stdout: "",
          stderr: `${reason.text}\n${USAGE}Code: ${reason.code}\n`,
        });
        expectNothingSecret(run.stderr);
        expect(load).not.toHaveBeenCalled();
      }
    );

    it.each([
      [["--help"]],
      [["--email", OPERATOR_EMAIL, "--help"]],
      [["--reissue", "--email", OPERATOR_EMAIL, "--help"]],
    ])(
      "returns 0 and writes the help on standard output, loading nothing, when given %j",
      async (args) => {
        const { load } = makeCommand(async () => ok(makeCreated()));
        const stdout = makeStream();
        const stderr = makeStream();

        const code = await runFirstAdministratorCommand(args, { stdout, stderr }, load);

        expect(code).toBe(0);
        expect(stderr.text()).toBe("");
        const help = stdout.text();
        for (const line of [
          "Usage: create-first-admin --email <address> [--reissue]",
          "Creates the first administrator of a database that has none",
          "is marked to change that password (mustChangePassword): sign in with\nit and change it at once.",
          "Without --reissue it creates an administrator once: once an administrator exists, every\nlater run without --reissue is refused.",
          "With --reissue it prints a new single-use password for the administrator with that e-mail",
          "instead, for when its single-use password was never seen. It serves any active administrator,\nnot only the first, who has never signed in and is still marked to change the password.",
          "Any\nother administrator is refused and nothing is changed; a deactivated one must be reactivated\nfirst.",
          "--email <address>  The e-mail of the administrator to create, or whose single-use password\n                     to re-issue.",
          "--reissue          Re-issues the single-use password instead of creating an administrator.",
          "Its standard output must be an interactive terminal",
          "0  The administrator was created, or its single-use password was re-issued.",
          "1  Refused (an administrator exists, or the administration role is held; with --reissue, no\n     administrator has the e-mail, it has signed in, it is not marked, it is deactivated, or it\n     changed between the read and the write) or failed.",
          "2  The arguments are wrong, the sign-in refuses the e-mail, or standard output is not a terminal.",
          "A refusal or a failure ends with a line Code: <CODE>",
        ]) {
          expect(help).toContain(line);
        }
        expect(help).not.toContain("It runs once");
        expect(help).not.toContain("the first administrator's password");
        expect(load).not.toHaveBeenCalled();
      }
    );
  });

  describe("the terminal", () => {
    it.each([{ isTTY: false }, { isTTY: undefined }])(
      "refuses with exit code 2, loading nothing, when standard output's isTTY is $isTTY",
      async ({ isTTY }) => {
        const { load } = makeCommand(async () => ok(makeCreated()));
        const stdout = makeStream(isTTY);
        const stderr = makeStream();

        const code = await runFirstAdministratorCommand(
          ["--email", OPERATOR_EMAIL],
          { stdout, stderr },
          load
        );

        expect({ code, stdout: stdout.text(), stderr: stderr.text() }).toEqual({
          code: 2,
          stdout: "",
          stderr: TERMINAL_REFUSAL,
        });
        expect(load).not.toHaveBeenCalled();
      }
    );

    it.each([{ isTTY: false }, { isTTY: undefined }])(
      "refuses a re-issue with exit code 2, loading nothing, when standard output's isTTY is $isTTY",
      async ({ isTTY }) => {
        const { load } = makeReissueCommand(async () => ok(makeReissued()));
        const stdout = makeStream(isTTY);
        const stderr = makeStream();

        const code = await runFirstAdministratorCommand(
          ["--reissue", "--email", OPERATOR_EMAIL],
          { stdout, stderr },
          load
        );

        expect({ code, stdout: stdout.text(), stderr: stderr.text() }).toEqual({
          code: 2,
          stdout: "",
          stderr: TERMINAL_REFUSAL,
        });
        expect(load).not.toHaveBeenCalled();
      }
    );
  });

  describe("the database connection", () => {
    it("checks the connection once the composition is loaded and before the use case runs", async () => {
      const steps: string[] = [];
      const { load } = makeCommand(
        async () => {
          steps.push("use case");
          return ok(makeCreated());
        },
        async () => {
          steps.push("close");
        },
        async () => {
          steps.push("connect");
        }
      );

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], async () => {
        steps.push("load");
        return load();
      });

      expect(run.code).toBe(0);
      expect(steps).toEqual(["load", "connect", "use case", "close"]);
    });

    it.each([
      { mode: "the creation", args: ["--email", OPERATOR_EMAIL] },
      { mode: "the re-issue", args: ["--reissue", "--email", OPERATOR_EMAIL] },
    ])(
      "returns 1, runs no use case and closes the connection, naming the unreachable database and never its address, when the check rejects before $mode",
      async ({ args }) => {
        const { load, execute, reissue, close } = makeCommand(
          async () => ok(makeCreated()),
          async () => undefined,
          async () => {
            throw makeRefusedConnection();
          }
        );

        const run = await runInTerminal(args, load);

        expect(run).toEqual({
          code: 1,
          stdout: "",
          stderr: `${DATABASE_UNREACHABLE}Cause: Error, code ECONNREFUSED\nCode: DATABASE_UNREACHABLE\n`,
        });
        expectNothingSecret(run.stderr);
        expect(execute).not.toHaveBeenCalled();
        expect(reissue).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("re-issuing the single-use password", () => {
    it("returns 0 and writes the re-issue's block with the password exactly once on standard output and nothing on standard error", async () => {
      const { load, create, execute, close } = makeReissueCommand(async () => ok(makeReissued()));

      const run = await runInTerminal(["--reissue", "--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({ code: 0, stdout: reissuedBlock(makeSingleUsePassword()), stderr: "" });
      expect(occurrences(run.stdout, makeSingleUsePassword())).toBe(1);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ email: OPERATOR_EMAIL });
      expect(create).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("states in the re-issue's lock line the minutes of the brute-force protection's default lock", async () => {
      const { load } = makeReissueCommand(async () => ok(makeReissued()));

      const run = await runInTerminal(["--reissue", "--email", OPERATOR_EMAIL], load);

      const stated = /ends by itself within (\d+) minutes\.$/m.exec(run.stdout)?.[1];
      expect(Number(stated)).toBe(DEFAULT_LOCKOUT_DURATION_MINUTES);
    });

    it("re-issues when --reissue follows the e-mail", async () => {
      const { load, create, execute } = makeReissueCommand(async () => ok(makeReissued()));

      const run = await runInTerminal(["--email", OPERATOR_EMAIL, "--reissue"], load);

      expect(run.code).toBe(0);
      expect(execute).toHaveBeenCalledWith({ email: OPERATOR_EMAIL });
      expect(create).not.toHaveBeenCalled();
    });

    it("runs the creation and not the re-issue when --reissue is not given", async () => {
      const { load, execute, reissue } = makeCommand(async () => ok(makeCreated()));

      await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(reissue).not.toHaveBeenCalled();
    });

    it.each([
      {
        definition: AUTH_ERRORS.ADMINISTRATOR_NOT_FOUND,
        code: "ADMINISTRATOR_NOT_FOUND",
        message: "No administrator has this e-mail: there is no single-use password to re-issue",
      },
      {
        definition: AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_SIGNED_IN,
        code: "PASSWORD_REISSUE_REFUSED_SIGNED_IN",
        message:
          "This administrator has signed in, so its password is no longer a single-use password nobody saw: it is not re-issued",
      },
      {
        definition: AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_NOT_MARKED,
        code: "PASSWORD_REISSUE_REFUSED_NOT_MARKED",
        message:
          "This administrator is not marked to change its password, so its password is its own and not a single-use password: it is not re-issued",
      },
      {
        definition: AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_DEACTIVATED,
        code: "PASSWORD_REISSUE_REFUSED_DEACTIVATED",
        message:
          "This administrator is deactivated, so no password lets it sign in: it must be reactivated first, and its password is not re-issued",
      },
      {
        definition: AUTH_ERRORS.PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ,
        code: "PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ",
        message:
          "The administrator changed between the read and the write (another re-issue, a password change, a requested password reset, a sign-in or a deactivation), so nothing was replaced: run the re-issue again to see what is true now",
      },
    ])(
      "returns 1 and writes only the refusal's message and its code on standard error when the re-issue is refused with $code",
      async ({ definition, code, message }) => {
        const refusal = UseCaseError.of(definition, { cause: makeLeakyStoreFailure() });
        const { load, close } = makeReissueCommand(async () => err(refusal));

        const run = await runInTerminal(["--reissue", "--email", OPERATOR_EMAIL], load);

        expect(run).toEqual({
          code: 1,
          stdout: "",
          stderr: `Refused: ${message}\nCode: ${code}\n`,
        });
        expect(close).toHaveBeenCalledTimes(1);
      }
    );

    it("returns 1 and writes the message, each cause's class and code and the failure's code, never a cause's message, when the re-issue fails", async () => {
      const failure = UseCaseError.of(AUTH_ERRORS.SINGLE_USE_PASSWORD_REPLACE_FAILED, {
        cause: new RepositoryFailureError("Replacing failed", makeLeakyStoreFailure()),
      });
      const { load } = makeReissueCommand(async () => err(failure));

      const run = await runInTerminal(["--reissue", "--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr: [
          "Failed: Replacing the single-use password failed",
          "Cause: RepositoryFailureError, code REPOSITORY_FAILURE",
          "Cause: Error, code P2010",
          "Code: SINGLE_USE_PASSWORD_REPLACE_FAILED",
          "",
        ].join("\n"),
      });
      expectNothingSecret(run.stderr);
    });

    it("returns 1, closes the connection and tells the operator to run the re-issue again when the re-issue rejects", async () => {
      const { load, close } = makeReissueCommand(async () => {
        throw makeLeakyStoreFailure();
      });

      const run = await runInTerminal(["--reissue", "--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr: `${NO_ANSWER.reissue}Cause: Error, code P2010\nCode: PASSWORD_REISSUE_NO_ANSWER\n`,
      });
      expectNothingSecret(run.stderr);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("on success", () => {
    it("returns 0 and writes the block with the password exactly once on standard output and nothing on standard error", async () => {
      const { load, execute, close } = makeCommand(async () => ok(makeCreated()));

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({ code: 0, stdout: successBlock(makeSingleUsePassword()), stderr: "" });
      expect(occurrences(run.stdout, makeSingleUsePassword())).toBe(1);
      expect(load).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ email: OPERATOR_EMAIL });
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("passes the e-mail as given, the --email=<address> form included", async () => {
      const { load, execute } = makeCommand(async () => ok(makeCreated()));

      await runInTerminal([`--email= ${OPERATOR_EMAIL.toUpperCase()}`], load);

      expect(execute).toHaveBeenCalledWith({ email: ` ${OPERATOR_EMAIL.toUpperCase()}` });
    });

    it("returns 0 and reports the failure to close with its code on standard error when the connection does not close", async () => {
      const { load, close } = makeCommand(
        async () => ok(makeCreated()),
        async () => {
          throw makeLeakyStoreFailure();
        }
      );

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 0,
        stdout: successBlock(makeSingleUsePassword()),
        stderr:
          "Failed: Closing the database connection failed.\nCause: Error, code P2010\nCode: FIRST_ADMIN_COMMAND_CLOSE_FAILED\n",
      });
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("refusals", () => {
    it.each([
      {
        definition: AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS,
        code: "ADMINISTRATOR_ALREADY_EXISTS",
        message:
          "An administrator already exists: the first administrator is created only on a database that has none",
      },
      {
        definition: AUTH_ERRORS.ADMINISTRATION_ROLE_WRITTEN_BY_ANOTHER_RUN,
        code: "ADMINISTRATION_ROLE_WRITTEN_BY_ANOTHER_RUN",
        message:
          "Another run of this command wrote the administration role first: check whether an administrator exists",
      },
      {
        definition: AUTH_ERRORS.ADMINISTRATION_ROLE_NAME_HELD,
        code: "ADMINISTRATION_ROLE_NAME_HELD",
        message:
          "A role with the administration role's name exists under another id, so every run of this command is refused until that role is renamed or removed",
      },
    ])(
      "returns 1 and writes only the refusal's message and its code on standard error when the creation is refused with $code",
      async ({ definition, code, message }) => {
        const refusal = UseCaseError.of(definition, { cause: makeLeakyStoreFailure() });
        const { load, close } = makeCommand(async () => err(refusal));

        const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

        expect(run).toEqual({
          code: 1,
          stdout: "",
          stderr: `Refused: ${message}\nCode: ${code}\n`,
        });
        expect(close).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      {
        definition: AUTH_ERRORS.ADMINISTRATOR_EMAIL_INVALID,
        code: "ADMINISTRATOR_EMAIL_INVALID",
        message: "The e-mail is not an address the administrators' sign-in accepts",
      },
      {
        definition: AUTH_ERRORS.ADMINISTRATOR_EMAIL_HAS_NO_LOCAL_PART,
        code: "ADMINISTRATOR_EMAIL_HAS_NO_LOCAL_PART",
        message: "The e-mail has no local part to name the administrator after",
      },
    ])(
      "returns 2 and writes the message, the usage and the code when the creation refuses the address with $code",
      async ({ definition, code, message }) => {
        const { load, close } = makeCommand(async () => err(UseCaseError.of(definition)));

        const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

        expect(run).toEqual({ code: 2, stdout: "", stderr: `${message}\n${USAGE}Code: ${code}\n` });
        expect(close).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("failures", () => {
    it("returns 1 and writes the message, each cause's class and code and the failure's code, never a cause's message", async () => {
      const store = makeLeakyStoreFailure();
      const repository = new RepositoryFailureError("Writing a system role failed", store);
      const failure = UseCaseError.of(AUTH_ERRORS.ADMINISTRATION_ROLE_WRITE_FAILED, {
        cause: repository,
      });
      const { load, close } = makeCommand(async () => err(failure));

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr: [
          "Failed: Writing the administration role failed",
          "Cause: RepositoryFailureError, code REPOSITORY_FAILURE",
          "Cause: Error, code P2010",
          "Code: ADMINISTRATION_ROLE_WRITE_FAILED",
          "",
        ].join("\n"),
      });
      expectNothingSecret(run.stderr);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        given: "a conflict worded by its builder",
        error: () => new UseCaseError(`refused ${OPERATOR_EMAIL}`, USE_CASE_ERRORS.CONFLICT),
        exit: 1,
        stderr:
          "Refused: The request conflicts with the current state of the resource\nCode: CONFLICT\n",
      },
      {
        given: "a validation failure worded by its builder",
        error: () =>
          new UseCaseError(`invalid ${OPERATOR_EMAIL}`, USE_CASE_ERRORS.VALIDATION_FAILED),
        exit: 2,
        stderr: `The request is not valid\n${USAGE}Code: VALIDATION_FAILED\n`,
      },
      {
        given: "a code the registry does not hold",
        error: () =>
          new UseCaseError(
            `failed ${OPERATOR_EMAIL}`,
            "NOT_A_REGISTERED_CODE",
            makeLeakyStoreFailure()
          ),
        exit: 1,
        stderr:
          "Failed: The server could not complete the request\nCause: Error, code P2010\nCode: INTERNAL_ERROR\n",
      },
    ])(
      "writes the registry's text for the code and never the error's own message, given $given",
      async ({ error, exit, stderr }) => {
        const { load } = makeCommand(async () => err(error()));

        const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

        expect(run).toEqual({ code: exit, stdout: "", stderr });
        expectNothingSecret(run.stderr);
      }
    );

    it("writes a cause's class without its code when the code is not an upper-case identifier", async () => {
      const cause = Object.assign(new TypeError(`bad ${OPERATOR_EMAIL}`), { code: OPERATOR_EMAIL });
      const failure = UseCaseError.of(AUTH_ERRORS.ADMINISTRATOR_CREATE_FAILED, { cause });
      const { load } = makeCommand(async () => err(failure));

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "Failed: Creating the administrator failed\nCause: TypeError\nCode: ADMINISTRATOR_CREATE_FAILED\n",
      });
    });

    it("returns 1 with the class and code of the error, never its message, when the composition does not load", async () => {
      const load = vi.fn(async (): Promise<FirstAdministratorCommand> => {
        throw makeLeakyStoreFailure();
      });

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "Failed: the command could not be set up in this environment; it must run in the API's environment.\nCause: Error, code P2010\nCode: FIRST_ADMIN_COMMAND_SETUP_FAILED\n",
      });
      expectNothingSecret(run.stderr);
    });

    it("returns 1 and names the refused variables, never their values, when the environment is refused", async () => {
      const refusal = RegisteredError.of(
        PLATFORM_ERRORS.ENV_VARIABLES_REFUSED,
        { variables: ["DATABASE_URL", "JWT_ACCESS_SECRET"] },
        {
          cause: new Error(
            `  - DATABASE_URL: ${PLANTED_DATABASE_URL} is not a URL\n  - JWT_ACCESS_SECRET: ${PLANTED_SECRET} is too short`
          ),
        }
      );
      const load = vi.fn(async (): Promise<FirstAdministratorCommand> => {
        throw refusal;
      });

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "Failed: The environment was refused: these variables are missing or not valid: DATABASE_URL, JWT_ACCESS_SECRET\nCause: Error\nCode: ENV_VARIABLES_REFUSED\n",
      });
      expectNothingSecret(run.stderr);
    });

    it("reports any other coded failure of the setup as the setup's failure, with the error as its cause", async () => {
      const load = vi.fn(async (): Promise<FirstAdministratorCommand> => {
        throw RegisteredError.of(PLATFORM_ERRORS.DATABASE_UNREACHABLE);
      });

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "Failed: the command could not be set up in this environment; it must run in the API's environment.\nCause: RegisteredError, code DATABASE_UNREACHABLE\nCode: FIRST_ADMIN_COMMAND_SETUP_FAILED\n",
      });
    });

    it("returns 1, closes the connection and writes no message of the error when the use case rejects", async () => {
      const { load, close } = makeCommand(async () => {
        throw makeLeakyStoreFailure();
      });

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr: `${NO_ANSWER.create}Cause: Error, code P2010\nCode: FIRST_ADMINISTRATOR_NO_ANSWER\n`,
      });
      expectNothingSecret(run.stderr);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
