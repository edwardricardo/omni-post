/**
 * @file artifactLanguageGate.test.ts
 * @description Pins `scripts/testing/artifact-language-gate.mjs`, fitness #53, the gate behind
 *   `pnpm check:artifact-language`: per tracked text file, its Spanish lines and its personal-name
 *   mentions equal the committed baseline in both directions; the baseline fails closed and is
 *   deleted once every count is zero; the allowlist and the generated records exempt only the
 *   counters and the files they name. Every case builds its own git repository in a scratch
 *   directory, every allowlisted and generated path planted in English beside one file of recorded
 *   debt, so the suite measures the rule and never this repository. The suite plants Spanish lines
 *   and the person's name on purpose, which is why the gate's allowlist names it.
 * @layer infrastructure
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Counter = "spanish" | "names";
type Outcome = { exitCode: number; messages: string[] };
type AllowEntry = {
  path?: string;
  pattern?: RegExp;
  line?: RegExp;
  twin?: string;
  exempt: readonly Counter[];
  reason: string;
};
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  BASELINE: string;
  ALLOWLIST: readonly AllowEntry[];
  GENERATED: ReadonlyMap<string, string>;
  runGate: (input: { root: string; write?: boolean }) => Outcome;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/artifact-language-gate.mjs");
const { BASELINE, ALLOWLIST, GENERATED, runGate } = (await import(GATE_SCRIPT)) as GateModule;
const SPAWN_TIMEOUT = 30_000;

/** A sample of the one pattern entry: a migration. */
const MIGRATION = "infra/prisma/migrations/20260101000000_init/migration.sql";
const INVESTOR = "docs/product/INVESTOR_ES.md";
const INVESTOR_TWIN = "docs/product/INVESTOR_EN.md";
const GOVERNANCE = "docs/GOVERNANCE.md";
const COMMON = ".claude/hooks-py/_common.py";
const GRANT_LINE = 'GRANT_ISSUER = "edward"';
const INBOX = "packages/core/inbox/src/handlers/InboxEventHandlers.ts";
const LEGACY = "docs/legacy.md";
const GUIDE = "docs/guide.md";

const ENGLISH_LINE = "This document explains what the system is for.";
const SPANISH_LINE = "Este documento explica para qué sirve el sistema.";
const NAMED_LINE = "Reviewed by Edward on Monday.";
const SPANISH_HINT = "Write it in English";
const NAMES_HINT = "Name the role (Product Owner or Maintainer), never the person";

let root = "";

const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CEILING_DIRECTORIES: path.dirname(root),
});
const git = (...args: string[]): void => {
  execFileSync("git", args, { cwd: root, env: gitEnvironment(), stdio: "ignore" });
};
const write = (file: string, content: string | Buffer = `${ENGLISH_LINE}\n`): void => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
};
const writeBaseline = (entries: Record<string, unknown>): void =>
  write(BASELINE, `${JSON.stringify(entries, null, 2)}\n`);
/** Stages the tree, since the gate reads git's listing, then runs the gate over it. */
const scan = (mode: { write?: boolean } = {}): Outcome => {
  git("add", "--all");
  return runGate({ root, ...mode });
};
const newDebt = (file: string, counter: Counter, now: number, lines: string): string =>
  `${file}: ${counter} ${now}, baseline 0: new debt at ${lines}. ` +
  (counter === "spanish" ? SPANISH_HINT : NAMES_HINT);
/** One counted line per counter an entry exempts, so the default tree holds no inert entry. */
const exemptContent = (entry: AllowEntry): string =>
  entry.line === undefined
    ? `${entry.exempt.map((counter) => (counter === "spanish" ? SPANISH_LINE : NAMED_LINE)).join("\n")}\n`
    : `${GRANT_LINE}\n`;
const entryAt = (file: string): AllowEntry | undefined =>
  ALLOWLIST.find((entry) => entry.path === file);
const migrations = ALLOWLIST.find((entry) => entry.pattern !== undefined);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "artifact-language-gate-test-"));
  git("init", "--quiet");
  for (const entry of ALLOWLIST) {
    if (entry.path !== undefined) write(entry.path, exemptContent(entry));
    if (entry.twin !== undefined) write(entry.twin);
  }
  for (const file of GENERATED.keys()) write(file);
  write(MIGRATION, `-- ${SPANISH_LINE}\n`);
  write("README.md");
  write(LEGACY, `# Legacy\n${SPANISH_LINE}\n`);
  writeBaseline({ [LEGACY]: { spanish: 1, names: 0 } });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scope", () => {
  it("allowlists every exemption the convention names, each with its reason", () => {
    const paths = ALLOWLIST.map((entry) => entry.path);

    expect(BASELINE).toBe("scripts/testing/artifact-language-baseline.json");
    expect(entryAt(GOVERNANCE)?.exempt).toEqual(["names"]);
    expect(entryAt("apps/client/messages/es.json")?.exempt).toEqual(["spanish"]);
    expect(entryAt(INBOX)?.reason).toContain("DEF-151");
    expect(entryAt(COMMON)?.exempt).toEqual(["names"]);
    expect(entryAt(COMMON)?.line?.test(GRANT_LINE)).toBe(true);
    expect(entryAt(INVESTOR)?.twin).toBe(INVESTOR_TWIN);
    expect(entryAt("docs/product/MARKETING_ES.md")?.twin).toBe("docs/product/MARKETING_EN.md");
    expect(ALLOWLIST.filter((entry) => entry.pattern !== undefined)).toHaveLength(1);
    for (const gone of [
      "CODEOWNERS",
      ".github/dependabot.yml",
      ".claude/hooks-py/pre_edit_tripwire_blocker.py",
      "apps/admin/components/shared/SidebarNav.tsx",
    ]) {
      expect(paths).not.toContain(gone);
    }
    expect(ALLOWLIST.filter((entry) => entry.reason.trim() === "")).toEqual([]);
    expect([...GENERATED.values()].filter((source) => source.trim() === "")).toEqual([]);
    expect([...GENERATED.keys()]).toEqual(
      expect.arrayContaining(["ledger.json", "probes.json", "pnpm-lock.yaml"])
    );
  });
});

describe("counting", () => {
  it("exits 0 when every file's counts equal its baseline entry", () => {
    const outcome = scan();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages[0]).toContain(
      `1 Spanish line and 0 name mentions in 1 file equal ${BASELINE}`
    );
  });

  it("exits 1 on a planted Spanish line, naming its file, its count and its line", () => {
    write(GUIDE, `# Guide\n${SPANISH_LINE}\n`);

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [newDebt(GUIDE, "spanish", 1, "line 2")],
    });
  });

  it("counts two distinct stopwords on an unaccented line, but never one alone", () => {
    write(GUIDE, "Los Angeles is far away.\nla lista de los pasos para el deploy\n");

    expect(scan().messages).toEqual([newDebt(GUIDE, "spanish", 1, "line 2")]);
  });

  it("exits 1 on a planted name, naming its file, its count and its line", () => {
    write(GUIDE, `# Guide\n${NAMED_LINE}\n`);

    expect(scan()).toEqual({ exitCode: 1, messages: [newDebt(GUIDE, "names", 1, "line 2")] });
  });

  it("counts each name word in any case, accented or not and ended by an underscore", () => {
    write(GUIDE, "VELASQUEZ, Velásquez and edward\nEDWARD_FLAG=1\nedwardricardo signs\n");

    expect(scan().messages).toEqual([
      newDebt(GUIDE, "spanish", 1, "line 1"),
      newDebt(GUIDE, "names", 4, "lines 1, 2"),
    ]);
  });

  it("reads no github.com/edwardricardo/ URL as a mention, whatever path it holds", () => {
    write(
      GUIDE,
      "See https://github.com/edwardricardo/omni-post/blob/abc/docs/edward.md and " +
        "(github.com/edwardricardo/omni-post/pull/1).\n"
    );

    expect(scan().exitCode).toBe(0);
  });

  it.each([",", ")", "]", ">", '"', "'", "`"])(
    "ends a permalink at %s, so a name written right after it counts",
    (delimiter) => {
      write(GUIDE, `github.com/edwardricardo/omni-post/blob/abc/README.md${delimiter}Edward\n`);

      expect(scan().messages).toEqual([newDebt(GUIDE, "names", 1, "line 1")]);
    }
  );

  it("skips a binary file", () => {
    write("assets/blob.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(NAMED_LINE)]));

    expect(scan().exitCode).toBe(0);
  });
});

describe("against the baseline", () => {
  it("exits 1 on a count above its baseline entry", () => {
    write(LEGACY, `${SPANISH_LINE}\n${SPANISH_LINE}\n`);

    expect(scan().messages).toEqual([
      `${LEGACY}: spanish 2, baseline 1: new debt at lines 1, 2. ${SPANISH_HINT}`,
    ]);
  });

  it("exits 1 on a lowered count until the baseline is lowered with it", () => {
    write(GUIDE, `${SPANISH_LINE}\n${NAMED_LINE}\n`);
    writeBaseline({ [GUIDE]: { spanish: 1, names: 2 }, [LEGACY]: { spanish: 1, names: 0 } });

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [
        `${GUIDE}: names 1, baseline 2: stale baseline. Lower it to 1 in ${BASELINE} in this ` +
          "change (node scripts/testing/artifact-language-gate.mjs --write)",
      ],
    });

    writeBaseline({ [GUIDE]: { spanish: 1, names: 1 }, [LEGACY]: { spanish: 1, names: 0 } });

    expect(scan().exitCode).toBe(0);
  });

  it("exits 1 on an entry for a file git does not track", () => {
    writeBaseline({ "docs/gone.md": { spanish: 3, names: 0 }, [LEGACY]: { spanish: 1, names: 0 } });

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [`docs/gone.md: in ${BASELINE}, but git tracks no such file. Delete its entry`],
    });
  });

  it("exits 1 asking for the baseline's deletion once every count is zero", () => {
    write(LEGACY);

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [
        `every count is zero: delete ${BASELINE} in this change, and the gate requires zero from ` +
          "then on",
      ],
    });
  });
});

describe("fails closed", () => {
  const legacy = { spanish: 1, names: 0 };
  const shapeError = `${LEGACY}: an entry is an object holding exactly "spanish" and "names"`;

  it.each([
    ["is not JSON", "{", "is not JSON"],
    ["is not an object", "[]", "is not an object of counts per file"],
    ["holds an entry that is not an object", JSON.stringify({ [LEGACY]: 1 }), shapeError],
    ["holds another key", JSON.stringify({ [LEGACY]: { ...legacy, extra: 0 } }), shapeError],
    ["holds a negative count", JSON.stringify({ [LEGACY]: { ...legacy, names: -1 } }), "names"],
    ["holds a fraction", JSON.stringify({ [LEGACY]: { ...legacy, spanish: 1.5 } }), "spanish"],
    ["holds a string", JSON.stringify({ [LEGACY]: { ...legacy, names: "0" } }), "names"],
    ["holds two zero counts", JSON.stringify({ [LEGACY]: { spanish: 0, names: 0 } }), "both"],
  ])("exits 3 when the baseline %s", (_case, text, cause) => {
    write(BASELINE, text);

    const outcome = scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.messages.join("\n")).toContain(cause);
  });

  it("exits 1 with no baseline while a file still counts: zero is then required", () => {
    rmSync(path.join(root, BASELINE));

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [
        `no ${BASELINE}, so every count must be zero, and 1 file counts. It is deleted only ` +
          "once every count is zero: restore it if it left early",
        newDebt(LEGACY, "spanish", 1, "line 2"),
      ],
    });
  });

  it("exits 3 when git tracks no file, so a scan that read nothing is never clean", () => {
    const outcome = runGate({ root });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.messages.join("\n")).toContain("git tracks no file");
  });
});

describe("allowlist and generated records", () => {
  it("counts nothing in a file exempt from both counters", () => {
    write(MIGRATION, `-- ${SPANISH_LINE}\n-- ${NAMED_LINE}\n`);
    write([...GENERATED.keys()][0] ?? "", `${SPANISH_LINE}\n${NAMED_LINE}\n`);

    expect(scan().exitCode).toBe(0);
  });

  it("exempts only the counter an entry names", () => {
    write(GOVERNANCE, `${SPANISH_LINE}\n${NAMED_LINE}\n`);
    write(INBOX, `// ${SPANISH_LINE}\n// ${NAMED_LINE}\n`);

    expect(scan().messages).toEqual([
      newDebt(GOVERNANCE, "spanish", 1, "line 1"),
      newDebt(INBOX, "names", 1, "line 2"),
    ]);
  });

  it("exempts a Spanish edition only while its English twin is tracked", () => {
    rmSync(path.join(root, INVESTOR_TWIN));

    expect(scan().messages).toEqual([
      `allowlist: ${INVESTOR}: its English twin ${INVESTOR_TWIN} is not tracked`,
      newDebt(INVESTOR, "spanish", 1, "line 1"),
    ]);
  });

  it("exits 1 on an allowlist entry or a generated record git does not track", () => {
    const generated = [...GENERATED.keys()][0] ?? "";
    rmSync(path.join(root, GOVERNANCE));
    rmSync(path.join(root, generated));

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [
        `allowlist: ${GOVERNANCE} is not tracked: delete its entry`,
        `generated: ${generated} is not tracked: delete its entry`,
      ],
    });
  });

  it.each([
    ["a file entry", INBOX, `// ${ENGLISH_LINE}\n`, INBOX],
    ["the pattern entry", MIGRATION, `-- ${ENGLISH_LINE}\n`, String(migrations?.pattern)],
    [
      "the line entry",
      COMMON,
      'GRANT_ISSUER = "maintainer"\n',
      `${COMMON} at ${String(entryAt(COMMON)?.line)}`,
    ],
  ])("exits 1 on %s that exempts no counted line", (_case, file, content, label) => {
    write(file, content);

    expect(scan()).toEqual({
      exitCode: 1,
      messages: [`allowlist: ${label} exempts no counted line: delete its entry`],
    });
  });

  it("never refuses a generated record that counts zero: its exclusion is structural", () => {
    write([...GENERATED.keys()][0] ?? "", `${ENGLISH_LINE}\n`);

    expect(scan().exitCode).toBe(0);
  });
});

describe("the GRANT_ISSUER line", () => {
  const line = String(entryAt(COMMON)?.line);

  it("exempts that one line, and another name in the same file still counts", () => {
    write(COMMON, `${GRANT_LINE}\n# ${NAMED_LINE}\n`);

    expect(scan().messages).toEqual([newDebt(COMMON, "names", 1, "line 2")]);
  });

  it.each([
    ["is renamed away", 'ISSUER = "edward"\n', 0],
    ["appears twice", `${GRANT_LINE}\n${GRANT_LINE}\n`, 2],
  ])("exits 1 when the exempt line %s", (_case, content, matched) => {
    write(COMMON, content);

    const outcome = scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.messages).toContain(
      `allowlist: ${COMMON}: ${line} matches ${matched} lines, and exactly one is required`
    );
  });
});

describe("--write", () => {
  it("rewrites the baseline from the tree, one entry per counted file in code-unit order", () => {
    write("docs/b.md", `${NAMED_LINE}\n`);
    write("docs/a.md", `${SPANISH_LINE}\n`);

    expect(scan({ write: true })).toEqual({
      exitCode: 0,
      messages: [`wrote ${BASELINE}: 3 files, 2 Spanish lines, 1 name mention`],
    });
    expect(readFileSync(path.join(root, BASELINE), "utf8")).toBe(
      `${JSON.stringify(
        {
          "docs/a.md": { spanish: 1, names: 0 },
          "docs/b.md": { spanish: 0, names: 1 },
          [LEGACY]: { spanish: 1, names: 0 },
        },
        null,
        2
      )}\n`
    );
    expect(scan().exitCode).toBe(0);
  });

  it("deletes the baseline once every count is zero, and the gate then requires zero", () => {
    write(LEGACY);

    expect(scan({ write: true })).toEqual({
      exitCode: 0,
      messages: [`every count is zero: deleted ${BASELINE}`],
    });
    expect(readdirSync(path.join(root, path.dirname(BASELINE)))).not.toContain(
      path.basename(BASELINE)
    );
    expect(scan().exitCode).toBe(0);

    write(GUIDE, `${NAMED_LINE}\n`);

    expect(scan().exitCode).toBe(1);
  });
});

describe("command line", () => {
  it("exits 2 with the usage line on an unknown argument", () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT, "--update"], {
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "usage: node scripts/testing/artifact-language-gate.mjs [--write] [--root <dir>]"
    );
  });

  it("checks the tree --root names, on stdout when clean and on stderr with exit 1 when not", () => {
    git("add", "--all");
    const run = (): SpawnSyncReturns<string> =>
      spawnSync(process.execPath, [GATE_SCRIPT, "--root", root], {
        encoding: "utf8",
        env: gitEnvironment(),
        timeout: SPAWN_TIMEOUT,
      });

    const clean = run();

    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("artifact-language-gate: ");

    write(GUIDE, `${SPANISH_LINE}\n`);
    git("add", "--all");
    const red = run();

    expect(red.status).toBe(1);
    expect(red.stderr).toContain(
      `artifact-language-gate: ${newDebt(GUIDE, "spanish", 1, "line 1")}`
    );
  });
});
