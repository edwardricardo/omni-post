/**
 * @file cli.test.ts
 * @description Self-tests of the shared command-line entry: a command runs only when its module is
 *              the script node was started with, and then writes its output and sets the exit code.
 *              `process.argv`, `process.exitCode` and stdout are restored after every case.
 * @layer infrastructure
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIfInvoked, type CliResult } from "../src/lib/cli.js";

/** A command module's location, standing in for its `import.meta.url`. */
const SCRIPT = path.resolve("planted-command.ts");

describe("runIfInvoked", () => {
  const savedArgv = process.argv;
  const savedExitCode = process.exitCode;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.argv = savedArgv;
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
  });

  it("runs main with the arguments after the script, prints its output and sets the exit code", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const main = vi.fn((): Promise<CliResult> => Promise.resolve({ code: 3, output: "ran\n" }));
    process.argv = [process.execPath, SCRIPT, "--json", "x"];

    await runIfInvoked(pathToFileURL(SCRIPT).href, main);

    expect(main).toHaveBeenCalledWith(["--json", "x"]);
    expect(write).toHaveBeenCalledWith("ran\n");
    expect(process.exitCode).toBe(3);
  });

  it("runs nothing when the module is not the script node was started with", async () => {
    const main = vi.fn((): Promise<CliResult> => Promise.resolve({ code: 3, output: "ran\n" }));
    process.argv = [process.execPath, path.resolve("another-command.ts")];

    await runIfInvoked(pathToFileURL(SCRIPT).href, main);

    expect(main).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("runs nothing when node was started with no script", async () => {
    const main = vi.fn((): Promise<CliResult> => Promise.resolve({ code: 3, output: "ran\n" }));
    process.argv = [process.execPath];

    await runIfInvoked(pathToFileURL(SCRIPT).href, main);

    expect(main).not.toHaveBeenCalled();
  });
});
