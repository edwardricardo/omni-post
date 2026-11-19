/**
 * @file firstAdministratorCommand.test.ts
 * @description Unit tests for `runFirstAdministratorCommand`, the function the first-administrator
 *   command's entry runs, with its streams and its composition replaced by doubles. They pin the
 *   argument table, `--help`, the refusal when standard output is not a terminal, the success
 *   block (the single-use password exactly once on standard output and never on standard error),
 *   every refusal and failure, and the exit codes; and that standard error never carries a cause's
 *   message, so nothing of the input, no hash and no password reaches it even when a cause holds
 *   them. The composition is loaded only once the arguments and the terminal are right.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { err, ok, type Result } from "@shared/types";
import { USE_CASE_ERRORS, UseCaseError } from "@core/application/UseCase.js";
import { RepositoryFailureError } from "@core/domain/errors/RepositoryFailureError.js";
import type { CreateFirstAdministratorOutput } from "@core/auth";
import {
  runFirstAdministratorCommand,
  type FirstAdministratorCommand,
} from "../../../src/cli/firstAdministratorCommand.js";

/** The address as the operator types it, and the form the use case stores and returns. */
const OPERATOR_EMAIL = "  First.Admin@Example.COM ";
const STORED_EMAIL = "first.admin@example.com";
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$Zml4dHVyZQ$Zml4dHVyZS1oYXNo";

const USAGE = "Usage: create-first-admin --email <address>\nRun it with --help for what it does.\n";

const REASONS = {
  missing: "The e-mail of the administrator to create is required.",
  value: "--email takes the administrator's address as its value, and --help takes none.",
  unknown: "This command takes only --email <address> and --help.",
  repeated: "--email is given more than once.",
} as const;

const TERMINAL_REFUSAL =
  "This command prints a single-use password, so it runs only in an interactive terminal: its standard output is not a terminal, and the password would be kept wherever that output goes. Run it again with its output on a terminal.\n";

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

/** The composition double: a use case that answers `outcome`, and a close that `closeOutcome` ends. */
function makeCommand(
  outcome: () => Promise<Result<CreateFirstAdministratorOutput, UseCaseError>>,
  closeOutcome: () => Promise<void> = async () => undefined
) {
  const execute = vi.fn(outcome);
  const close = vi.fn(closeOutcome);
  const command: FirstAdministratorCommand = { createFirstAdministrator: { execute }, close };
  const load = vi.fn(async () => command);
  return { execute, close, load };
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

/** Asserts that a text holds nothing of the input, the hash or the password. */
function expectNothingSecret(text: string): void {
  expect(text).not.toContain(OPERATOR_EMAIL.trim());
  expect(text.toLowerCase()).not.toContain("first.admin");
  expect(text).not.toContain(PASSWORD_HASH);
  expect(text).not.toContain(makeSingleUsePassword());
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
    ])(
      "refuses with exit code 2, the reason and the usage, echoing no argument, when given $args",
      async ({ args, reason }) => {
        const { load } = makeCommand(async () => ok(makeCreated()));

        const run = await runInTerminal(args, load);

        expect(run).toEqual({ code: 2, stdout: "", stderr: `${reason}\n${USAGE}` });
        expectNothingSecret(run.stderr);
        expect(load).not.toHaveBeenCalled();
      }
    );

    it.each([[["--help"]], [["--email", OPERATOR_EMAIL, "--help"]]])(
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
          "Usage: create-first-admin --email <address>",
          "Creates the first administrator of a database that has none",
          "is marked to change that password (mustChangePassword): sign in with\nit and change it at once.",
          "It runs once: once an administrator exists, every later run is refused.",
          "--email <address>  The e-mail of the administrator to create, its only input.",
          "Its standard output must be an interactive terminal",
          "0  The administrator was created.",
          "1  Refused (an administrator exists, or the administration role is held) or failed.",
          "2  The arguments are wrong, the sign-in refuses the e-mail, or standard output is not a terminal.",
        ]) {
          expect(help).toContain(line);
        }
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

    it("returns 0 and reports the failure to close on standard error when the connection does not close", async () => {
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
        stderr: "Closing the database connection failed.\nCause: Error, code P2010\n",
      });
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("refusals", () => {
    it.each([
      "An administrator already exists: the first administrator is created only on a database that has none",
      "Another run of this command wrote the administration role first: check whether an administrator exists",
      "A role with the administration role's name exists under another id, so every run of this command is refused until that role is renamed or removed",
    ])(
      "returns 1 and writes only the use case's message on standard error when it refuses: %s",
      async (message) => {
        const refusal = new UseCaseError(
          message,
          USE_CASE_ERRORS.CONFLICT,
          makeLeakyStoreFailure()
        );
        const { load, close } = makeCommand(async () => err(refusal));

        const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

        expect(run).toEqual({ code: 1, stdout: "", stderr: `Refused: ${message}\n` });
        expect(close).toHaveBeenCalledTimes(1);
      }
    );

    it("returns 2 and writes the use case's message with the usage when the sign-in's rule refuses the address", async () => {
      const message = "The e-mail is not an address the administrators' sign-in accepts";
      const { load, close } = makeCommand(async () =>
        err(new UseCaseError(message, USE_CASE_ERRORS.VALIDATION_FAILED))
      );

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({ code: 2, stdout: "", stderr: `${message}\n${USAGE}` });
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("failures", () => {
    it("returns 1 and writes the message and each cause's class and code, never a cause's message", async () => {
      const store = makeLeakyStoreFailure();
      const repository = new RepositoryFailureError("Writing a system role failed", store);
      const failure = new UseCaseError(
        "Writing the administration role failed",
        USE_CASE_ERRORS.INTERNAL_ERROR,
        repository
      );
      const { load, close } = makeCommand(async () => err(failure));

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr: [
          "Failed: Writing the administration role failed",
          "Cause: RepositoryFailureError, code REPOSITORY_FAILURE",
          "Cause: Error, code P2010",
          "",
        ].join("\n"),
      });
      expectNothingSecret(run.stderr);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("writes a cause's class without its code when the code is not an upper-case identifier", async () => {
      const cause = Object.assign(new TypeError(`bad ${OPERATOR_EMAIL}`), { code: OPERATOR_EMAIL });
      const failure = new UseCaseError(
        "Creating the administrator failed",
        USE_CASE_ERRORS.INTERNAL_ERROR,
        cause
      );
      const { load } = makeCommand(async () => err(failure));

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr: "Failed: Creating the administrator failed\nCause: TypeError\n",
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
          "Failed: the command could not be set up in this environment; it must run in the API's environment.\nCause: Error, code P2010\n",
      });
      expectNothingSecret(run.stderr);
    });

    it("returns 1, closes the connection and writes no message of the error when the use case rejects", async () => {
      const { load, close } = makeCommand(async () => {
        throw makeLeakyStoreFailure();
      });

      const run = await runInTerminal(["--email", OPERATOR_EMAIL], load);

      expect(run).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "Failed: creating the first administrator stopped without an answer, so whether it was created is not known: check whether an administrator exists before running it again.\nCause: Error, code P2010\n",
      });
      expectNothingSecret(run.stderr);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
