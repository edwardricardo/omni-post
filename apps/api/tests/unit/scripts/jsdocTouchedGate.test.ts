/**
 * @file jsdocTouchedGate.test.ts
 * @description Pins the mechanics of `scripts/testing/jsdoc-touched-gate.mjs`, the gate behind
 *   `pnpm check:jsdoc`: which files it reads and from where. Every case builds its own git repository
 *   in a scratch directory, with one documented and one undocumented function as its only fixtures:
 *   a touched undocumented file fails and an untouched one is never read, a deletion and the
 *   out-of-scope paths are ignored, a rename counts as touched, the four modes read what they say,
 *   an `eslint-disable` directive exempts nothing, `--all` reports, and an unresolvable base fails
 *   closed. The rules themselves are pinned by `jsdocRules.test.ts`.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Request =
  | { mode: "base"; base: string }
  | { mode: "staged" }
  | { mode: "all" }
  | { mode: "files"; files: string[] };
type Outcome = { exitCode: 0 | 1 | 2; messages: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  parseRequest: (argv: string[], env: Record<string, string | undefined>) => Request | null;
  runGate: (input: { cwd: string; request: Request }) => Promise<Outcome>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/jsdoc-touched-gate.mjs");
const { parseRequest, runGate } = (await import(GATE_SCRIPT)) as GateModule;

const UNDOCUMENTED = "export function double(value: number): number {\n  return value * 2;\n}\n";
const DOCUMENTED =
  "/**\n * @description Doubles a number.\n * @param value - The number.\n * @returns Twice it.\n */\n" +
  UNDOCUMENTED;
const UNTOUCHED = "apps/api/src/untouched.ts";
const TOUCHED = "apps/api/src/touched.ts";
/** Git without the variables a hook exports, which would point it at another repository. */
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
);

let root = "";

const write = (file: string, text: string): void => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", env: GIT_ENV });
const commitAll = (): void => {
  git("add", "-A");
  git("commit", "--quiet", "-m", "change");
};
const check = (request: Request): Promise<Outcome> => runGate({ cwd: root, request });
const againstMain = (): Promise<Outcome> => check({ mode: "base", base: "main" });
/** The findings for one file, as `line rule message`, from checking that file alone. */
const findingsFor = async (file: string, text: string): Promise<string[]> => {
  write(file, text);
  const outcome = await check({ mode: "files", files: [path.join(root, file)] });
  return outcome.messages
    .filter((m) => m.startsWith(`${file}:`))
    .map((m) => m.slice(file.length + 1));
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "jsdoc-touched-gate-test-")));
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  write(UNTOUCHED, UNDOCUMENTED);
  commitAll();
  git("checkout", "--quiet", "-b", "feature");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("which files it reads", () => {
  it("exits 1 naming a touched file's undocumented exported function, and never reads an untouched one", async () => {
    write(TOUCHED, UNDOCUMENTED);
    commitAll();

    const outcome = await againstMain();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages[0]).toBe(`${TOUCHED}:1 jsdoc/require-jsdoc Missing JSDoc comment.`);
    expect(outcome.messages.join("\n")).not.toContain(UNTOUCHED);
  });

  it("exits 0 on a documented touched file while an undocumented file stays untouched", async () => {
    write(TOUCHED, DOCUMENTED);
    commitAll();

    const outcome = await againstMain();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages).toEqual([
      expect.stringMatching(
        /^1 touched in-scope files in main \(merge base [0-9a-f]{8}\): zero violations$/
      ),
    ]);
  });

  it("checks the whole touched file, not only its edited lines", async () => {
    write(UNTOUCHED, `${UNDOCUMENTED}${DOCUMENTED.replace(/double/g, "triple")}`);
    commitAll();

    const outcome = await againstMain();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages[0]).toBe(`${UNTOUCHED}:1 jsdoc/require-jsdoc Missing JSDoc comment.`);
  });

  it("ignores a deleted file, and says a change with no in-scope file is a clean pass", async () => {
    git("rm", "--quiet", UNTOUCHED);
    commitAll();

    const outcome = await againstMain();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages[0]).toMatch(
      /^0 touched in-scope files in main .*\(0 changed, none in scope\): a clean pass$/
    );
  });

  it("counts a renamed file as touched", async () => {
    git("mv", UNTOUCHED, "apps/api/src/renamed.ts");
    commitAll();

    const outcome = await againstMain();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages[0]).toBe(
      "apps/api/src/renamed.ts:1 jsdoc/require-jsdoc Missing JSDoc comment."
    );
  });

  it("ignores tests, specs, stories, declarations, generated code, JavaScript and every path outside apps and packages", async () => {
    const outside = [
      "scripts/tool.ts",
      "infra/prisma/generated/client.ts",
      "apps/api/src/double.test.ts",
      "apps/api/src/double.spec.ts",
      "apps/client/components/Double.stories.tsx",
      "apps/api/src/double.d.ts",
      "apps/api/src/double.js",
      "packages/shared/dist/double.ts",
      "apps/client/.next/double.ts",
    ];
    outside.forEach((file) => write(file, UNDOCUMENTED));
    commitAll();

    const outcome = await againstMain();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages[0]).toContain(
      `(${outside.length} changed, none in scope): a clean pass`
    );
  });
});

describe("the base", () => {
  it("exits 2 when the base ref does not resolve", async () => {
    const outcome = await check({ mode: "base", base: "no-such-ref" });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.messages[0]).toMatch(/^base ref no-such-ref did not resolve/);
  });

  it("defaults to origin/main, and exits 2 in a clone that has no origin", async () => {
    const request = parseRequest([], {});

    expect(request).toEqual({ mode: "base", base: "origin/main" });
    expect((await check(request as Request)).exitCode).toBe(2);
  });

  it("reads the base from --base, then JSDOC_BASE_REF, and refuses a malformed command line", () => {
    expect(parseRequest([], { JSDOC_BASE_REF: "abc123" })).toEqual({
      mode: "base",
      base: "abc123",
    });
    expect(parseRequest(["--base", "main"], { JSDOC_BASE_REF: "abc123" })).toEqual({
      mode: "base",
      base: "main",
    });
    expect(parseRequest(["--staged"], {})).toEqual({ mode: "staged" });
    expect(parseRequest(["--all"], {})).toEqual({ mode: "all" });
    expect(parseRequest(["a.ts", "b.ts"], {})).toEqual({ mode: "files", files: ["a.ts", "b.ts"] });
    for (const argv of [
      ["--base"],
      ["--staged", "a.ts"],
      ["--all", "--staged"],
      ["--fix"],
      ["a.ts", "--all"],
    ]) {
      expect(parseRequest(argv, {})).toBeNull();
    }
  });
});

describe("its modes", () => {
  it("--staged reads each staged file from the index, not the working tree", async () => {
    write(TOUCHED, UNDOCUMENTED);
    git("add", TOUCHED);
    write(TOUCHED, DOCUMENTED);

    const outcome = await check({ mode: "staged" });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages[0]).toBe(`${TOUCHED}:1 jsdoc/require-jsdoc Missing JSDoc comment.`);
  });

  it("--staged reads a staged file the working tree has since deleted", async () => {
    write(TOUCHED, UNDOCUMENTED);
    git("add", TOUCHED);
    rmSync(path.join(root, TOUCHED));

    const outcome = await check({ mode: "staged" });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages[0]).toBe(`${TOUCHED}:1 jsdoc/require-jsdoc Missing JSDoc comment.`);
  });

  it("checks exactly the named files, skipping the ones out of scope", async () => {
    write("scripts/tool.ts", UNDOCUMENTED);

    const named = await check({ mode: "files", files: [path.join(root, "scripts/tool.ts")] });
    const inScope = await check({ mode: "files", files: [path.join(root, UNTOUCHED)] });

    expect(named.exitCode).toBe(0);
    expect(inScope.exitCode).toBe(1);
  });

  it("exits 2 on a named file outside the repository, even one that exists", async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "jsdoc-touched-gate-outside-")));
    try {
      const file = path.join(outside, "apps/api/src/double.ts");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, UNDOCUMENTED);

      const absolute = await check({ mode: "files", files: [path.join(root, UNTOUCHED), file] });
      const relative = await check({ mode: "files", files: ["../escape.ts"] });

      expect(absolute.exitCode).toBe(2);
      expect(absolute.messages).toEqual([
        `${file} is outside the repository at ${root}: the gate checks only its files`,
      ]);
      expect(relative.exitCode).toBe(2);
      expect(relative.messages[0]).toContain("escape.ts is outside the repository at");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("--all lists every violating file with its count and exits 1 while any is left", async () => {
    write("apps/api/src/documented.ts", DOCUMENTED);
    commitAll();

    const outcome = await check({ mode: "all" });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages).toEqual([
      `${UNTOUCHED}\t1`,
      "1 of 2 in-scope files in the tree violate (1 violations)",
    ]);
  });

  it("--all exits 0 on a clean tree and 2 on a tree with no in-scope file", async () => {
    write(UNTOUCHED, DOCUMENTED);
    commitAll();
    const clean = await check({ mode: "all" });
    git("rm", "--quiet", UNTOUCHED);
    commitAll();
    const empty = await check({ mode: "all" });

    expect(clean).toEqual({
      exitCode: 0,
      messages: ["0 of 1 in-scope files in the tree violate (0 violations)"],
    });
    expect(empty.exitCode).toBe(2);
  });

  it("the command line prints its lines and exits with the gate's code", () => {
    write(TOUCHED, UNDOCUMENTED);
    commitAll();
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
        cwd: root,
        encoding: "utf8",
        env: GIT_ENV,
      });

    const failing = run("--base", "main");
    const usage = run("--fix");

    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(
      `jsdoc-touched-gate: ${TOUCHED}:1 jsdoc/require-jsdoc Missing JSDoc comment.`
    );
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("usage: node scripts/testing/jsdoc-touched-gate.mjs");
  });
});

describe("its scope", () => {
  it("exits 2 before reading the base when the config no longer reaches apps/api/src/index.ts", () => {
    const harness = realpathSync(mkdtempSync(path.join(tmpdir(), "jsdoc-touched-gate-harness-")));
    try {
      const script = path.join(harness, "scripts/testing/jsdoc-touched-gate.mjs");
      mkdirSync(path.dirname(script), { recursive: true });
      copyFileSync(GATE_SCRIPT, script);
      const config = readFileSync(path.join(REPO_ROOT, "eslint.jsdoc.config.ts"), "utf8");
      const moved = config.replace(
        '"apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"',
        '"packages/**/*.{ts,tsx}"'
      );
      expect(moved).not.toBe(config);
      writeFileSync(path.join(harness, "eslint.jsdoc.config.ts"), moved);
      symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(harness, "node_modules"));
      write(TOUCHED, UNDOCUMENTED);
      commitAll();

      const run = spawnSync(process.execPath, [script, "--base", "no-such-ref"], {
        cwd: root,
        encoding: "utf8",
        env: GIT_ENV,
      });

      expect(run.status).toBe(2);
      expect(run.stderr).toBe(
        "jsdoc-touched-gate: the config no longer reaches apps/api/src/index.ts: its scope moved, so a pass would be blind\n"
      );
    } finally {
      rmSync(harness, { recursive: true, force: true });
    }
  });
});

describe("what counts as a violation", () => {
  it("an eslint-disable directive does not exempt a file", async () => {
    const lines = await findingsFor(
      TOUCHED,
      `// eslint-disable-next-line jsdoc/require-jsdoc\n${UNDOCUMENTED}`
    );

    expect(lines).toEqual([
      "2 jsdoc/require-jsdoc Missing JSDoc comment. (an eslint-disable directive does not exempt it)",
    ]);
  });
});
