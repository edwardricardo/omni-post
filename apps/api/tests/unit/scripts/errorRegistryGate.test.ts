/**
 * @file errorRegistryGate.test.ts
 * @description Pins `scripts/testing/error-registry-gate.mjs`, the first script of
 *   `pnpm check:errors`: the error registry under `packages/shared/src/error-registry/` is whole.
 *   Each case plants its own small tree in a scratch directory (a registry whose TypeScript
 *   imports use `.js` specifiers, the two portals with their catalogs, a feature file that
 *   references every code, and a git index over all of it), passes its own exclusion list and its
 *   own reader of the history of existing sites, so the suite measures the rules and never this
 *   repository's registry. The cases of the rules other than R9 write the page first and then
 *   check, so each shows its own rule's finding alone. Pinned here: R1 (one table per domain file,
 *   its entries' domain, every table of `ERROR_TABLES` exported by one domain file and every domain
 *   file's table in it), R2 (the grammar and length of a code and its key), R3 (a code in one
 *   table), R4 (a status of its category), R5 (one line of words whose placeholders are the declared
 *   parameters), R6 (parameter names and kinds, portals that exist and appear once), R7 (an enrolled
 *   portal, and only an enrolled one, holds in every locale a text for each code it can receive and
 *   for nothing else, each reading only declared parameters in a form their kind takes, with no
 *   tag), R8 (every code referenced as `<TABLE>.<CODE>` in the rule's scope outside the registry, in
 *   code and not in a comment or a string), R9 (the page is what the registry and the history yield;
 *   `--write` writes it, never from an input it could not read), R10 (`defineErrors` named nowhere
 *   else in the rule's scope) and R11 (every `<NAME>_ERRORS` an `of` call reads is a table of
 *   `ERROR_TABLES`). Every fail-closed path the gate's header names is pinned to exit 3, apart from
 *   the verdict's exit 1, and exit 3 wins over 1 with both printed, so a registry that was not read
 *   never renders as a whole one.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Outcome = { exitCode: number; stdout: string[]; stderr: string[] };

interface HistoryRow {
  readonly file: string;
  readonly row: {
    readonly born?: { readonly rule: string; readonly contexts: Record<string, number> };
    readonly fixed?: Record<string, number>;
    readonly moved?: readonly {
      readonly from: string;
      readonly to: string;
      readonly count: number;
    }[];
  };
}

/** The sites gate's reader of the history, which the gate takes as a parameter. */
interface HistoryReader {
  readonly read: (root: string) => { exists: boolean; rows: HistoryRow[]; problems: string[] };
  readonly stateOf: (rows: readonly HistoryRow[]) => ReadonlyMap<string, number>;
}

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type GateModule = {
  REGISTRY_DIRECTORY: string;
  RULE_ID: string;
  runGate: (input: {
    root: string;
    exclusions: unknown;
    history: HistoryReader;
    write?: boolean;
  }) => Promise<Outcome>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts/testing/error-registry-gate.mjs");
const { REGISTRY_DIRECTORY, RULE_ID, runGate } = (await import(GATE_SCRIPT)) as GateModule;

const REGISTRY = "packages/shared/src/error-registry";
const DOMAINS = `${REGISTRY}/domains`;
const INDEX = `${REGISTRY}/index.ts`;
const REFERENCES = "packages/core/auth/src/references.ts";
const ROGUE = "packages/core/auth/src/rogue.ts";
const SCOPE_MODULE = "scripts/testing/lib/error-scope.mjs";
const USAGE = "usage: node scripts/testing/error-registry-gate.mjs [--write] [--root <dir>]";
const PAGE = "docs/api/ERROR_CODES.md";
const WRITE_COMMAND = "node scripts/testing/error-registry-gate.mjs --write";
const DOMAIN_GRAMMAR = "^[a-z][a-z0-9]*(-[a-z0-9]+)*$";
const CODE_GRAMMAR = "^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$";
const PARAMETER_GRAMMAR = "^[a-z][A-Za-z0-9]*$";
const PORTAL_FLOOR_LINE =
  "below the floor of 2; a portal is a directory directly under apps/ holding i18n/routing.ts and messages/";

/** The shape of section 4.4's list, with its kinds and its brace and globstar syntax. */
const EXCLUSIONS = [
  { glob: "**/*.test.{ts,tsx,mts,cts}", kind: "test-suffix", reason: "Test files" },
  { glob: "**/*.d.{ts,mts,cts}", kind: "declaration", reason: "No executable code" },
  { glob: "apps/*/tests/**", kind: "outside-src", reason: "Test code beside a source tree" },
  { glob: "packages/**/vitest*.config.ts", kind: "outside-src", reason: "Configuration" },
  { glob: "scripts/**", kind: "whole-root", reason: "Tooling" },
  { glob: "apps/admin/**", kind: "whole-root", reason: "A front" },
  { glob: "apps/client/**", kind: "whole-root", reason: "A front" },
];

type Fields = Readonly<Record<string, unknown>>;

interface DomainFixture {
  readonly name: string;
  readonly entries: Readonly<Record<string, Fields>>;
  /** The name the file exports; `<NAME>_ERRORS` when absent. */
  readonly exportName?: string;
  /** False leaves the table out of `ERROR_TABLES`. */
  readonly listed?: boolean;
  /** False leaves the domain's codes out of the references file. */
  readonly referenced?: boolean;
  /** Lines appended to the generated file. */
  readonly extra?: readonly string[];
  /** The whole file, in place of the generated one. */
  readonly source?: string;
}

interface TreeFixture {
  readonly domains?: readonly DomainFixture[];
  /** The whole `tables.ts`, in place of the generated one. */
  readonly tables?: string;
  /** The whole `index.ts`, in place of the generated one. */
  readonly index?: string;
  /** Files written before the git index is built. */
  readonly files?: Readonly<Record<string, string>>;
  /** Files written after the git index is built, so git does not track them. */
  readonly untracked?: Readonly<Record<string, string>>;
  readonly portals?: readonly string[];
  /** Per portal, its catalogs by locale: an object is written as JSON, a string as written. */
  readonly catalogs?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Per portal, its whole `i18n/routing.ts`, in place of the generated one. */
  readonly routing?: Readonly<Record<string, string>>;
  /** False writes no git repository at all. */
  readonly tracked?: boolean;
}

const entry = (overrides: Fields = {}): Fields => ({
  category: "not_found",
  status: 404,
  message: "The requested resource was not found",
  params: {},
  fronts: ["admin", "client"],
  ...overrides,
});

const COMMON: DomainFixture = {
  name: "common",
  entries: {
    NOT_FOUND: entry(),
    CONFLICT: entry({
      category: "conflict",
      status: 409,
      message: "The request conflicts with the current state of the resource",
    }),
  },
};

const AUTH: DomainFixture = {
  name: "auth",
  entries: {
    ADMINISTRATOR_ALREADY_EXISTS: entry({
      category: "conflict",
      status: 409,
      message: "An administrator already exists: {email}",
      params: { email: "string" },
      fronts: [],
    }),
  },
};

/** `common` with one entry changed, the shape most single-rule cases need. */
const commonWith = (code: string, fields: Fields): DomainFixture => ({
  name: "common",
  entries: { [code]: entry(fields) },
});

/** `auth` with its one entry changed. */
const authWith = (fields: Fields): DomainFixture => ({
  name: "auth",
  entries: {
    ADMINISTRATOR_ALREADY_EXISTS: { ...AUTH.entries.ADMINISTRATOR_ALREADY_EXISTS, ...fields },
  },
});

const tableName = (name: string): string => `${name.toUpperCase().replaceAll("-", "_")}_ERRORS`;
const exportOf = (domain: DomainFixture): string => domain.exportName ?? tableName(domain.name);

/** A definition built as the real one is, except that an entry's own `code` or `domain` wins. */
const DEFINITION = [
  "export function defineErrors<T extends Record<string, object>>(domain: string, entries: T): T {",
  "  return Object.freeze(",
  "    Object.fromEntries(",
  "      Object.entries(entries).map(([code, entry]) => [code, Object.freeze({ code, domain, ...entry })])",
  "    )",
  "  ) as T;",
  "}",
  "",
].join("\n");

const domainSource = (domain: DomainFixture): string =>
  domain.source ??
  [
    'import { defineErrors } from "../definition.js";',
    "",
    `export const ${exportOf(domain)} = defineErrors(${JSON.stringify(domain.name)}, ${JSON.stringify(domain.entries, null, 2)});`,
    ...(domain.extra ?? []),
    "",
  ].join("\n");

const tablesSource = (domains: readonly DomainFixture[]): string => {
  const listed = domains.filter((domain) => domain.listed !== false);
  return [
    ...listed.map((domain) => `import { ${exportOf(domain)} } from "./domains/${domain.name}.js";`),
    "",
    `export const ERROR_TABLES = [${listed.map(exportOf).join(", ")}] as const;`,
    "",
  ].join("\n");
};

/** A feature file that raises every code of the referenced domains, one per line from line 4. */
const referencesSource = (domains: readonly DomainFixture[]): string => {
  const referenced = domains.filter((domain) => domain.referenced !== false);
  return [
    `import { RegisteredError, ${referenced.map(exportOf).join(", ")} } from "@shared/types";`,
    "",
    "export const raised = [",
    ...referenced.flatMap((domain) =>
      Object.keys(domain.entries).map(
        (code) => `  RegisteredError.of(${exportOf(domain)}.${code}),`
      )
    ),
    "];",
    "",
  ].join("\n");
};

/** A git environment that cannot reach a repository other than the planted one. */
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key)
  )
);

let root = "";

const write = (file: string, text: string): void => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};

const git = (...args: string[]): void => {
  execFileSync("git", args, { cwd: root, env: GIT_ENV, stdio: "ignore" });
};

const plant = (tree: TreeFixture = {}): void => {
  const domains = tree.domains ?? [COMMON, AUTH];
  write(`${REGISTRY}/definition.ts`, DEFINITION);
  for (const domain of domains) write(`${DOMAINS}/${domain.name}.ts`, domainSource(domain));
  write(`${REGISTRY}/tables.ts`, tree.tables ?? tablesSource(domains));
  write(INDEX, tree.index ?? 'export { ERROR_TABLES } from "./tables.js";\n');
  write(REFERENCES, referencesSource(domains));
  for (const portal of tree.portals ?? ["admin", "client"]) {
    const catalogs = tree.catalogs?.[portal] ?? { en: {} };
    write(
      `apps/${portal}/i18n/routing.ts`,
      tree.routing?.[portal] ??
        [
          'import { defineRouting } from "next-intl/routing";',
          "",
          "export const routing = defineRouting({",
          `  locales: [${Object.keys(catalogs)
            .map((locale) => JSON.stringify(locale))
            .join(", ")}],`,
          '  defaultLocale: "en",',
          "});",
          "",
        ].join("\n")
    );
    for (const [locale, catalog] of Object.entries(catalogs)) {
      write(
        `apps/${portal}/messages/${locale}.json`,
        typeof catalog === "string" ? catalog : `${JSON.stringify(catalog, null, 2)}\n`
      );
    }
  }
  for (const [file, text] of Object.entries(tree.files ?? {})) write(file, text);
  if (tree.tracked !== false) {
    git("-c", "init.defaultBranch=main", "init", "--quiet");
    git("add", "--all");
  }
  for (const [file, text] of Object.entries(tree.untracked ?? {})) write(file, text);
};

/** A context per directory: enough for the state of a planted history to be told apart. */
const contextOf = (file: string): string => path.posix.dirname(file);

/** The state of a history as the sites gate yields it: births, minus fixes, moves across. */
const stateOf = (rows: readonly HistoryRow[]): ReadonlyMap<string, number> => {
  const state = new Map<string, number>();
  const add = (context: string, delta: number): void => {
    state.set(context, (state.get(context) ?? 0) + delta);
  };
  for (const { row } of rows) {
    for (const [context, count] of Object.entries(row.born?.contexts ?? {})) add(context, count);
    for (const [context, count] of Object.entries(row.fixed ?? {})) add(context, -count);
    for (const move of row.moved ?? []) {
      add(contextOf(move.from), -move.count);
      add(contextOf(move.to), move.count);
    }
  }
  return state;
};

/** A reader whose history holds the given rows, or reports the given problems. */
const historyOf = (
  rows: readonly HistoryRow[],
  problems: readonly string[] = []
): HistoryReader => ({
  read: () => ({ exists: true, rows: [...rows], problems: [...problems] }),
  stateOf,
});
const NO_HISTORY: HistoryReader = {
  read: () => ({ exists: false, rows: [], problems: [] }),
  stateOf,
};
let history: HistoryReader = NO_HISTORY;

/** The gate in its check mode, as fitness #57 runs it. */
const check = (exclusions: unknown = EXCLUSIONS): Promise<Outcome> =>
  runGate({ root, exclusions, history });
/**
 * The page written, then the gate in its check mode: the cases of the other rules run on a tree
 * whose page is current, so each shows its own rule's finding alone.
 */
const scan = async (exclusions: unknown = EXCLUSIONS): Promise<Outcome> => {
  await runGate({ root, exclusions, history, write: true });
  return check(exclusions);
};
const lines = (...texts: string[]): string[] => texts.map((text) => `error-registry-gate: ${text}`);
const failure = async (tree: TreeFixture): Promise<Omit<Outcome, "stdout">> => {
  plant(tree);
  const { exitCode, stderr } = await scan();
  return { exitCode, stderr };
};
/** The clean run's lines when no portal has enrolled. */
const passing = (codes: string): string[] => [
  "error-registry-gate: PASS",
  codes,
  "admin: not enrolled",
  "client: not enrolled",
];

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "error-registry-gate-test-")));
  history = NO_HISTORY;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a whole registry", () => {
  it("reads the registry directory under the rule errors/no-inline-error", () => {
    expect(REGISTRY_DIRECTORY).toBe(REGISTRY);
    expect(RULE_ID).toBe("errors/no-inline-error");
  });

  it("passes a registry whose every rule holds, loaded through imports that use .js specifiers", async () => {
    plant();

    const outcome = await scan();

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: passing("3 codes in 2 domains"),
      stderr: [],
    });
  });

  it("counts an empty table as a domain that holds no code", async () => {
    plant({ domains: [COMMON, AUTH, { name: "platform", entries: {} }] });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual(passing("3 codes in 3 domains"));
  });

  it("reads a tree it has read before afresh, so a changed table is never answered from memory", async () => {
    plant();
    await scan();
    write(`${DOMAINS}/auth.ts`, domainSource(authWith({ status: 400 })));

    const outcome = await scan();

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toEqual(
      lines(`ADMINISTRATOR_ALREADY_EXISTS: has status 400; category "conflict" takes 409 (R4)`)
    );
  });
});

describe("R1: one table per domain file, and ERROR_TABLES is those tables", () => {
  it("refuses a domain file whose name breaks the domain grammar", async () => {
    const outcome = await failure({
      domains: [COMMON, AUTH, { name: "Sign_in", entries: { SIGN_IN_FAILED: entry() } }],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${DOMAINS}/Sign_in.ts: the domain name "Sign_in" does not match ${DOMAIN_GRAMMAR} (R1)`
      ),
    });
  });

  it("accepts a domain name of words joined by hyphens", async () => {
    plant({
      domains: [COMMON, AUTH, { name: "sign-in", entries: { SIGN_IN_FAILED: entry() } }],
    });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("refuses a domain file that exports a second name", async () => {
    const outcome = await failure({
      domains: [COMMON, { ...AUTH, extra: ["export const HELPER = 1;"] }],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${DOMAINS}/auth.ts: exports AUTH_ERRORS, HELPER; a domain file exports one table, AUTH_ERRORS, and nothing else (R1)`
      ),
    });
  });

  it("refuses a domain file whose one export is not named after its domain", async () => {
    const outcome = await failure({ domains: [COMMON, { ...AUTH, exportName: "LOGIN_ERRORS" }] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${DOMAINS}/auth.ts: exports LOGIN_ERRORS; a domain file exports one table, AUTH_ERRORS, and nothing else (R1)`
      ),
    });
  });

  it("refuses a domain file whose export is not a table", async () => {
    const outcome = await failure({
      domains: [
        COMMON,
        {
          ...AUTH,
          referenced: false,
          source: 'export const AUTH_ERRORS = ["ADMINISTRATOR_ALREADY_EXISTS"];\n',
        },
      ],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(`${DOMAINS}/auth.ts: AUTH_ERRORS is an array, not a table of definitions (R1)`),
    });
  });

  it("refuses an entry that is not a definition", async () => {
    const outcome = await failure({
      domains: [
        COMMON,
        {
          ...AUTH,
          source: 'export const AUTH_ERRORS = { ADMINISTRATOR_ALREADY_EXISTS: "conflict" };\n',
        },
      ],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines("ADMINISTRATOR_ALREADY_EXISTS: is a string, not a definition (R1)"),
    });
  });

  it("refuses an entry whose domain is not its file's", async () => {
    const outcome = await failure({ domains: [COMMON, authWith({ domain: "common" })] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `ADMINISTRATOR_ALREADY_EXISTS: has domain "common"; an entry of ${DOMAINS}/auth.ts has domain "auth" (R1)`
      ),
    });
  });

  it("refuses a table of ERROR_TABLES that no domain file exports", async () => {
    const outcome = await failure({
      tables: [
        'import { defineErrors } from "./definition.js";',
        'import { COMMON_ERRORS } from "./domains/common.js";',
        'import { AUTH_ERRORS } from "./domains/auth.js";',
        "",
        'export const ERROR_TABLES = [COMMON_ERRORS, AUTH_ERRORS, defineErrors("rogue", {})] as const;',
        "",
      ].join("\n"),
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${INDEX}: ERROR_TABLES[2] is the table of no domain file; every table of ERROR_TABLES is the export of one ${DOMAINS}/<name>.ts (R1)`
      ),
    });
  });

  it("refuses a table ERROR_TABLES lists twice", async () => {
    const outcome = await failure({
      tables: [
        'import { COMMON_ERRORS } from "./domains/common.js";',
        'import { AUTH_ERRORS } from "./domains/auth.js";',
        "",
        "export const ERROR_TABLES = [COMMON_ERRORS, AUTH_ERRORS, AUTH_ERRORS] as const;",
        "",
      ].join("\n"),
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${INDEX}: ERROR_TABLES lists AUTH_ERRORS 2 times; it lists each domain's table once (R1)`
      ),
    });
  });

  it("refuses a domain file whose table ERROR_TABLES leaves out, and the of call that reads it", async () => {
    const outcome = await failure({ domains: [COMMON, { ...AUTH, listed: false }] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${DOMAINS}/auth.ts: AUTH_ERRORS is not in ERROR_TABLES, so its codes are not found by their code (R1)`,
        `${REFERENCES}:6: an of call reads AUTH_ERRORS as its first argument, which is no table of ERROR_TABLES (R11)`
      ),
    });
  });

  it("refuses a file in domains/ that is not a domain file", async () => {
    const outcome = await failure({ files: { [`${DOMAINS}/notes.md`]: "# Notes\n" } });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${DOMAINS}/notes.md: is not a <name>.ts domain file, and domains/ holds nothing else (R1)`
      ),
    });
  });
});

describe("R2: the grammar of a code", () => {
  it.each(["notFound", "Not_Found", "NOT__FOUND", "_NOT_FOUND", "NOT_FOUND_", "NOT_FOUND$"])(
    "refuses the key %s",
    async (code) => {
      const outcome = await failure({ domains: [commonWith(code, {}), AUTH] });

      expect(outcome).toEqual({
        exitCode: 1,
        stderr: lines(`${code}: does not match ${CODE_GRAMMAR} (R2)`),
      });
    }
  );

  it("refuses a code of 64 characters", async () => {
    const code = `A${"_B".repeat(31)}C`;

    const outcome = await failure({ domains: [commonWith(code, {}), AUTH] });

    expect(code).toHaveLength(64);
    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(`${code}: is 64 characters long; a code is at most 63 (R2)`),
    });
  });

  it("accepts a code of 63 characters", async () => {
    const code = `A${"_B".repeat(31)}`;
    plant({ domains: [commonWith(code, {}), AUTH] });

    const outcome = await scan();

    expect(code).toHaveLength(63);
    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("refuses an entry whose code is not its key", async () => {
    const outcome = await failure({
      domains: [commonWith("NOT_FOUND", { code: "MISSING" }), AUTH],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(`NOT_FOUND: its entry's code is "MISSING"; an entry's code is its key (R2)`),
    });
  });
});

describe("R3: a code is in one table", () => {
  it("refuses a code two tables hold, naming both domains", async () => {
    const outcome = await failure({
      domains: [COMMON, AUTH, { name: "billing", entries: { NOT_FOUND: entry() } }],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "NOT_FOUND: is in the tables of billing and common; a code is in one table (R3)"
      ),
    });
  });
});

describe("R4: a category of the thirteen and one of its statuses", () => {
  it("refuses a category that is none of the thirteen", async () => {
    const outcome = await failure({
      domains: [commonWith("NOT_FOUND", { category: "teapot" }), AUTH],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(`NOT_FOUND: has category "teapot", which is none of the thirteen (R4)`),
    });
  });

  it.each([
    ["validation", 409, "400, 415, 417 or 422"],
    ["conflict", 400, "409"],
    ["upstream", 503, "502 or 504"],
    ["internal", 503, "500"],
    ["unavailable", "503", "503"],
  ])("refuses category %s with status %j", async (category, status, statuses) => {
    const outcome = await failure({ domains: [commonWith("FAILED", { category, status }), AUTH] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `FAILED: has status ${JSON.stringify(status)}; category "${category}" takes ${statuses} (R4)`
      ),
    });
  });

  it("accepts every status of every one of the thirteen categories", async () => {
    const pairs: [string, number][] = [
      ["validation", 400],
      ["validation", 415],
      ["validation", 417],
      ["validation", 422],
      ["authentication", 401],
      ["permission", 403],
      ["not_found", 404],
      ["conflict", 409],
      ["too_large", 413],
      ["too_large", 414],
      ["too_large", 431],
      ["timeout", 408],
      ["rate_limit", 429],
      ["not_implemented", 501],
      ["upstream", 502],
      ["upstream", 504],
      ["unavailable", 503],
      ["configuration", 500],
      ["internal", 500],
    ];
    const entries = Object.fromEntries(
      pairs.map(([category, status]) => [
        `CASE_${category.toUpperCase()}_${String(status)}`,
        entry({ category, status }),
      ])
    );
    plant({ domains: [COMMON, AUTH, { name: "cases", entries }] });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.stdout).toEqual(passing("22 codes in 3 domains"));
  });
});

describe("R5: a message is one line of words whose placeholders are its parameters", () => {
  it.each(["The first line\nThe second line", "The first line\rThe second line"])(
    "refuses the message %j, which spans two lines",
    async (message) => {
      const outcome = await failure({ domains: [commonWith("NOT_FOUND", { message }), AUTH] });

      expect(outcome).toEqual({
        exitCode: 1,
        stderr: lines("NOT_FOUND: its message spans more than one line (R5)"),
      });
    }
  );

  it.each(["", "   "])("refuses the empty message %j", async (message) => {
    const outcome = await failure({ domains: [commonWith("NOT_FOUND", { message }), AUTH] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines("NOT_FOUND: its message is empty (R5)"),
    });
  });

  it("refuses a message that is not a string", async () => {
    const outcome = await failure({ domains: [commonWith("NOT_FOUND", { message: 42 }), AUTH] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines("NOT_FOUND: its message is a number, not a string (R5)"),
    });
  });

  it("refuses a placeholder that no parameter declares", async () => {
    const outcome = await failure({
      domains: [
        COMMON,
        authWith({ message: "An administrator already exists: {email} since {date}" }),
      ],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "ADMINISTRATOR_ALREADY_EXISTS: its message holds {date}, which is no declared parameter (R5)"
      ),
    });
  });

  it("refuses a declared parameter that the message does not hold", async () => {
    const outcome = await failure({
      domains: [COMMON, authWith({ params: { email: "string", role: "string" } })],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "ADMINISTRATOR_ALREADY_EXISTS: declares the parameter role, which its message does not hold as {role} (R5)"
      ),
    });
  });

  it.each([
    ["{email}", { email: "string" }],
    [" {email} ", { email: "string" }],
    ["{email}: {role}!", { email: "string", role: "string" }],
  ])("refuses the message %j, which is placeholders alone", async (message, params) => {
    const outcome = await failure({ domains: [COMMON, authWith({ message, params })] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "ADMINISTRATOR_ALREADY_EXISTS: its message is placeholders alone; it holds no word of its own (R5)"
      ),
    });
  });
});

describe("R6: parameter names and kinds, and the portals of an entry", () => {
  it.each(["Email", "e-mail", "1email", "e_mail"])(
    "refuses the parameter name %s",
    async (name) => {
      const outcome = await failure({
        domains: [
          COMMON,
          authWith({
            message: `An administrator already exists: {${name}}`,
            params: { [name]: "string" },
          }),
        ],
      });

      expect(outcome).toEqual({
        exitCode: 1,
        stderr: lines(
          `ADMINISTRATOR_ALREADY_EXISTS: the parameter name ${JSON.stringify(name)} does not match ${PARAMETER_GRAMMAR} (R6)`
        ),
      });
    }
  );

  it.each(["text", "string[][]", "Number"])("refuses the parameter kind %s", async (kind) => {
    const outcome = await failure({ domains: [COMMON, authWith({ params: { email: kind } })] });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `ADMINISTRATOR_ALREADY_EXISTS: the parameter email has kind ${JSON.stringify(kind)}, which is none of string, number, boolean and string[] (R6)`
      ),
    });
  });

  it("accepts a parameter of each of the four kinds", async () => {
    plant({
      domains: [
        COMMON,
        authWith({
          message: "Refused for {email} after {attempts} attempts, locked {locked}, roles {roles}",
          params: { email: "string", attempts: "number", locked: "boolean", roles: "string[]" },
        }),
      ],
    });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("refuses parameters that are not an object of kinds", async () => {
    const outcome = await failure({
      domains: [
        COMMON,
        authWith({ message: "An administrator already exists", params: ["email"] }),
      ],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "ADMINISTRATOR_ALREADY_EXISTS: its params are an array, not an object of parameter kinds (R6)"
      ),
    });
  });

  it("refuses fronts that name a portal twice", async () => {
    const outcome = await failure({
      domains: [commonWith("NOT_FOUND", { fronts: ["admin", "client", "admin"] }), AUTH],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(`NOT_FOUND: its fronts name "admin" more than once (R6)`),
    });
  });

  it.each([["mobile"], [1]])("refuses fronts that name %j, which is no portal", async (front) => {
    const outcome = await failure({
      domains: [commonWith("NOT_FOUND", { fronts: ["admin", front] }), AUTH],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `NOT_FOUND: its fronts name ${JSON.stringify(front)}, which is no portal of the tree (admin, client) (R6)`
      ),
    });
  });

  it("refuses fronts that are not a list", async () => {
    const outcome = await failure({
      domains: [commonWith("NOT_FOUND", { fronts: "admin" }), AUTH],
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines("NOT_FOUND: its fronts are a string, not a list of portal ids (R6)"),
    });
  });

  it("takes the portals from the tree, so a third portal may be named", async () => {
    plant({
      domains: [commonWith("NOT_FOUND", { fronts: ["admin", "mobile"] }), AUTH],
      portals: ["admin", "client", "mobile"],
    });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("R7: an enrolled portal holds a text for each code it can receive, and nothing else", () => {
  /** A code only the administration portal receives, with one parameter of each kind. */
  const SIGN_IN: DomainFixture = {
    name: "sign-in",
    entries: {
      SIGN_IN_LOCKED: entry({
        category: "rate_limit",
        status: 429,
        message: "Locked for {minutes} minutes after {attempts} attempts as {role}, told {told}",
        params: { minutes: "number", attempts: "number", role: "string", told: "boolean" },
        fronts: ["admin"],
      }),
    },
  };
  const DOMAINS_FOR_PORTALS = [COMMON, AUTH, SIGN_IN];
  /** A text for each code the administration portal can receive, every format R7 allows used. */
  const TEXTS: Readonly<Record<string, string>> = {
    NOT_FOUND: "Nothing was found",
    CONFLICT: "Someone changed it first",
    SIGN_IN_LOCKED:
      "Locked for {minutes, plural, one {# minute} other {# minutes}} after {attempts, number} attempts as {role, select, admin {an administrator} other {{role}}}{told, select, true {; you were told} other {}}",
  };
  const generic = { errors: { generic: "Something failed" } };
  const enrolled = (en: unknown, es: unknown = en) => ({
    admin: { en: { ...generic, errorCodes: en }, es: { ...generic, errorCodes: es } },
  });
  /** The administration portal enrolled in one locale, with the given text for SIGN_IN_LOCKED. */
  const locked = (text: string) => ({
    admin: { en: { errorCodes: { ...TEXTS, SIGN_IN_LOCKED: text } } },
  });
  const SUBJECT = "apps/admin/messages/en.json: errorCodes.SIGN_IN_LOCKED";

  it("holds an enrolled portal in every locale and says so in its clean run", async () => {
    plant({ domains: DOMAINS_FOR_PORTALS, catalogs: enrolled(TEXTS) });

    const outcome = await scan();

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: [
        "error-registry-gate: PASS",
        "4 codes in 3 domains",
        "admin: enrolled, 3 codes",
        "client: not enrolled",
      ],
      stderr: [],
    });
  });

  it("asks nothing of a portal whose default locale holds no errorCodes, whatever another locale holds", async () => {
    plant({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: { admin: { en: generic, es: { ...generic, errorCodes: { OLD_CODE: "Old" } } } },
    });

    const outcome = await scan();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual([
      "error-registry-gate: PASS",
      "4 codes in 3 domains",
      "admin: not enrolled",
      "client: not enrolled",
    ]);
  });

  it("refuses a locale that has no text for a code the portal can receive", async () => {
    const { CONFLICT: _conflict, ...withoutConflict } = TEXTS;

    const outcome = await failure({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: enrolled(TEXTS, withoutConflict),
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "apps/admin/messages/es.json: has no errorCodes.CONFLICT, a code admin can receive (R7)"
      ),
    });
  });

  it("refuses a locale that holds no errorCodes while the default locale does", async () => {
    const outcome = await failure({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: { admin: { en: { ...generic, errorCodes: TEXTS }, es: generic } },
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "apps/admin/messages/es.json: holds no errorCodes, which admin's default locale holds, so no code admin can receive has its text in this locale (R7)"
      ),
    });
  });

  it.each([
    ["OLD_CODE", "is no code of the registry"],
    ["ADMINISTRATOR_ALREADY_EXISTS", "is a code whose fronts do not name admin"],
  ])("refuses a text for %s, which the portal cannot receive", async (key, problem) => {
    const outcome = await failure({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: { admin: { en: { errorCodes: { ...TEXTS, [key]: "A text" } } } },
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(`apps/admin/messages/en.json: errorCodes.${key} ${problem} (R7)`),
    });
  });

  it("refuses a text that is not a message", async () => {
    const outcome = await failure({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: { admin: { en: { errorCodes: { ...TEXTS, NOT_FOUND: { title: "Nothing" } } } } },
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "apps/admin/messages/en.json: errorCodes.NOT_FOUND is an object, not a message (R7)"
      ),
    });
  });

  it("refuses an errorCodes that is not an object of messages", async () => {
    const outcome = await failure({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: { admin: { en: { errorCodes: "Something failed" } } },
    });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        "apps/admin/messages/en.json: errorCodes is a string, not an object of messages keyed by code (R7)"
      ),
    });
  });

  it.each([
    ["Locked after {email} attempts", "reads {email}, which SIGN_IN_LOCKED does not declare"],
    [
      "{role, plural, one {# try} other {# tries}}",
      "reads {role} as a plural, which takes a number parameter; SIGN_IN_LOCKED declares it string",
    ],
    [
      "{minutes, select, other {Locked}}",
      "reads {minutes} as a select, which takes a string or boolean parameter; SIGN_IN_LOCKED declares it number",
    ],
    [
      "Locked as {role, number}",
      "reads {role} as a number, which takes a number parameter; SIGN_IN_LOCKED declares it string",
    ],
    ["Locked since {minutes, date}", "reads {minutes} as a date, and no parameter kind is one"],
    ["Locked at {minutes, time}", "reads {minutes} as a time, and no parameter kind is one"],
    ["Locked <b>now</b>", "holds the tag <b>; an error text holds no tag"],
    [
      "{minutes, plural, other {Locked for {email}}}",
      "reads {email}, which SIGN_IN_LOCKED does not declare",
    ],
    ["Locked {email} and {email}", "reads {email}, which SIGN_IN_LOCKED does not declare"],
  ])("refuses the text %j", async (text, problem) => {
    const outcome = await failure({ domains: DOMAINS_FOR_PORTALS, catalogs: locked(text) });

    expect(outcome).toEqual({ exitCode: 1, stderr: lines(`${SUBJECT} ${problem} (R7)`) });
  });

  it("exits 3 on a text that is not valid ICU, which R7 cannot read", async () => {
    const outcome = await failure({
      domains: DOMAINS_FOR_PORTALS,
      catalogs: locked("Locked for {minutes"),
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toMatch(
      /^error-registry-gate: apps\/admin\/messages\/en\.json: errorCodes\.SIGN_IN_LOCKED is not valid ICU, so R7 did not read its arguments: \S/
    );
  });

  it.each([
    ["no defaultLocale line", 'export const routing = { locales: ["en"] };\n', "no", "lines"],
    [
      "its defaultLocale inside one line, which fitness #51 does not read either",
      'export const routing = { locales: ["en"], defaultLocale: "en" };\n',
      "no",
      "lines",
    ],
    [
      "two defaultLocale lines",
      'export const a = {\n  defaultLocale: "en",\n};\nexport const b = {\n  defaultLocale: "es",\n};\n',
      "2",
      "lines",
    ],
  ])("exits 3 on a routing with %s", async (_shape, routing, count, noun) => {
    const outcome = await failure({ domains: DOMAINS_FOR_PORTALS, routing: { admin: routing } });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(
        `apps/admin/i18n/routing.ts: holds ${count} \`defaultLocale: "<locale>"\` ${noun} where the gate reads exactly one, so admin's enrolment was not read`
      ),
    });
  });

  it("exits 3 on a catalog that is not JSON", async () => {
    const outcome = await failure({ catalogs: { admin: { en: "{ not json" } } });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toMatch(
      /^error-registry-gate: apps\/admin\/messages\/en\.json: could not be read as JSON, so R7 did not read it: \S/
    );
  });

  it("exits 3 on a catalog that is not an object", async () => {
    const outcome = await failure({ catalogs: { admin: { en: ["Nothing was found"] } } });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(
        "apps/admin/messages/en.json: is an array, not an object of messages, so R7 did not read it"
      ),
    });
  });

  it("exits 3 when the default locale has no catalog", async () => {
    const outcome = await failure({ catalogs: { admin: { es: {} } } });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(
        "apps/admin/messages/en.json: does not exist, so admin's enrolment was not read"
      ),
    });
  });
});

describe("R9: the reference page is what the registry and the history yield", () => {
  const STALE = `${PAGE}: is not what the registry and the history yield; ${WRITE_COMMAND} rewrites it (R9)`;
  const pageOf = (): string => readFileSync(path.join(root, PAGE), "utf8");

  it("refuses a tree with no page", async () => {
    plant();

    const outcome = await check();

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: lines(
        `${PAGE}: does not exist; ${WRITE_COMMAND} writes it from the registry and the history (R9)`
      ),
    });
  });

  it("writes the page with --write, and the check then passes on it", async () => {
    plant();

    const written = await runGate({ root, exclusions: EXCLUSIONS, history, write: true });
    const checked = await check();

    expect(written).toEqual({
      exitCode: 0,
      stdout: [`error-registry-gate: wrote ${PAGE}`, ...passing("3 codes in 2 domains")],
      stderr: [],
    });
    expect(pageOf().split("\n")[0]).toBe("# Error codes");
    expect(checked).toEqual({ exitCode: 0, stdout: passing("3 codes in 2 domains"), stderr: [] });
  });

  it("refuses a page edited by hand", async () => {
    plant();
    await runGate({ root, exclusions: EXCLUSIONS, history, write: true });
    writeFileSync(path.join(root, PAGE), `${pageOf()}\nA note added by hand.\n`);

    const outcome = await check();

    expect(outcome).toEqual({ exitCode: 1, stdout: [], stderr: lines(STALE) });
  });

  it("refuses a page that differs only by a line break at its end", async () => {
    plant();
    await runGate({ root, exclusions: EXCLUSIONS, history, write: true });
    writeFileSync(path.join(root, PAGE), `${pageOf()}\n`);

    const outcome = await check();

    expect(outcome).toEqual({ exitCode: 1, stdout: [], stderr: lines(STALE) });
  });

  it("writes each context's count at the birth from the births alone, and now from every row", async () => {
    plant();
    history = historyOf([
      {
        file: "scripts/testing/error-sites-history/2026-11-21-birth.json",
        row: { born: { rule: "errors/no-inline-error", contexts: { "packages/core": 7 } } },
      },
      {
        file: "scripts/testing/error-sites-history/2026-11-22-fix.json",
        row: { fixed: { "packages/core": 2 } },
      },
    ]);

    await runGate({ root, exclusions: EXCLUSIONS, history, write: true });

    expect(pageOf()).toMatch(/^\| `packages\/core` +\| 7 +\| 5 +\|$/m);
  });

  it("refuses a page the registry has moved past", async () => {
    plant();
    await runGate({ root, exclusions: EXCLUSIONS, history, write: true });
    write(
      `${DOMAINS}/common.ts`,
      domainSource({
        ...COMMON,
        entries: { ...COMMON.entries, NOT_FOUND: entry({ message: "Nothing is there" }) },
      })
    );

    const outcome = await check();

    expect(outcome).toEqual({ exitCode: 1, stdout: [], stderr: lines(STALE) });
  });

  it("refuses a page the history has moved past, and shows the history it was written from", async () => {
    const birth: HistoryRow = {
      file: "scripts/testing/error-sites-history/2026-11-21-birth.json",
      row: { born: { rule: "errors/no-inline-error", contexts: { "packages/core": 7 } } },
    };
    const fix: HistoryRow = {
      file: "scripts/testing/error-sites-history/2026-11-22-fix.json",
      row: { fixed: { "packages/core": 2 } },
    };
    plant();
    history = historyOf([birth]);
    await runGate({ root, exclusions: EXCLUSIONS, history, write: true });
    const written = pageOf();
    history = historyOf([birth, fix]);

    const outcome = await check();

    expect(written).toContain("`2026-11-21-birth.json`");
    expect(written).not.toContain("`2026-11-22-fix.json`");
    expect(outcome).toEqual({ exitCode: 1, stdout: [], stderr: lines(STALE) });
  });

  it("writes the page beside a verdict, and still exits 1 on it", async () => {
    plant({ domains: [COMMON, AUTH, { name: "billing", entries: { NOT_FOUND: entry() } }] });

    const outcome = await runGate({ root, exclusions: EXCLUSIONS, history, write: true });

    expect(outcome).toEqual({
      exitCode: 1,
      stdout: [`error-registry-gate: wrote ${PAGE}`],
      stderr: lines(
        "NOT_FOUND: is in the tables of billing and common; a code is in one table (R3)"
      ),
    });
    expect(existsSync(path.join(root, PAGE))).toBe(true);
  });

  it("writes nothing when the registry could not be read", async () => {
    plant({ tables: "export const ERROR_TABLES = [];\n" });

    const outcome = await runGate({ root, exclusions: EXCLUSIONS, history, write: true });

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: lines(`${INDEX}: ERROR_TABLES is empty, so no code was read`),
    });
    expect(existsSync(path.join(root, PAGE))).toBe(false);
  });

  it("exits 3 on a history that is not the format of its rows, and judges no page", async () => {
    plant();
    history = historyOf(
      [],
      [
        "scripts/testing/error-sites-history/2026-11-21-birth.json: is not a row of the history: it is not an object",
      ]
    );

    const outcome = await check();

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: lines(
        "scripts/testing/error-sites-history/2026-11-21-birth.json: is not a row of the history: it is not an object"
      ),
    });
  });

  it("exits 3 when the history's reader fails", async () => {
    plant();
    history = {
      read: () => {
        throw new Error("EACCES: permission denied");
      },
      stateOf,
    };

    const outcome = await check();

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: lines(
        "scripts/testing/error-sites-history: could not be read, so the page's existing sites were not read: EACCES: permission denied"
      ),
    });
  });
});

describe("R8: every code is referenced in the rule's scope, outside the registry", () => {
  const unreferenced = lines(
    `ADMINISTRATOR_ALREADY_EXISTS: no tracked file of the rule's scope outside ${REGISTRY}/ references AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS (R8)`
  );

  it("refuses a code nothing references", async () => {
    const outcome = await failure({ domains: [COMMON, { ...AUTH, referenced: false }] });

    expect(outcome).toEqual({ exitCode: 1, stderr: unreferenced });
  });

  it.each([
    ["a line comment", ROGUE, "// AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS\nexport {};\n"],
    [
      "a block comment",
      ROGUE,
      "/** See AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS. */\nexport {};\n",
    ],
    ["a string", ROGUE, 'export const name = "AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS";\n'],
    [
      "another table's name",
      ROGUE,
      "export const x = COMMON_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
    ["a computed member", ROGUE, 'export const x = AUTH_ERRORS["ADMINISTRATOR_ALREADY_EXISTS"];\n'],
    [
      "the registry directory",
      `${REGISTRY}/uses.ts`,
      "export const x = AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
    [
      "an excluded test file",
      "packages/core/auth/src/a.test.ts",
      "export const x = AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
    [
      "an excluded root",
      "scripts/use.ts",
      "export const x = AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
  ])("does not count a reference in %s", async (_where, file, text) => {
    const outcome = await failure({
      domains: [COMMON, { ...AUTH, referenced: false }],
      files: { [file]: text },
    });

    expect(outcome).toEqual({ exitCode: 1, stderr: unreferenced });
  });

  it("does not count a reference in a file git does not track", async () => {
    const outcome = await failure({
      domains: [COMMON, { ...AUTH, referenced: false }],
      untracked: { [ROGUE]: "export const x = AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n" },
    });

    expect(outcome).toEqual({ exitCode: 1, stderr: unreferenced });
  });

  it.each([
    [
      "a .tsx file",
      "packages/core/auth/src/view.tsx",
      "export const x = <b>{AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS.code}</b>;\n",
    ],
    [
      "a .mts file",
      "packages/core/auth/src/use.mts",
      "export const x = AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
    [
      "a .cts file",
      "packages/core/auth/src/use.cts",
      "export const x = AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
    [
      "a namespace import",
      ROGUE,
      "export const x = shared.AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
    [
      "a member split over two lines",
      ROGUE,
      "export const x = AUTH_ERRORS\n  .ADMINISTRATOR_ALREADY_EXISTS;\n",
    ],
  ])("counts a reference in %s", async (_where, file, text) => {
    plant({ domains: [COMMON, { ...AUTH, referenced: false }], files: { [file]: text } });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("R10: defineErrors is named only in the registry, within the rule's scope", () => {
  it.each([
    [
      "an import",
      ROGUE,
      'import { defineErrors } from "@shared/types/error-registry/definition.js";\n',
      1,
    ],
    ["a computed read", ROGUE, 'export const make = shared["defineErrors"];\n', 1],
    ["a comment", ROGUE, "export {};\n// defineErrors builds tables\n", 2],
    [
      "a .mts file",
      "packages/core/auth/src/make.mts",
      "export { defineErrors } from './x.js';\n",
      1,
    ],
    [
      "a dotted directory",
      "packages/core/auth/src/.hidden/make.ts",
      "export const f = defineErrors;\n",
      1,
    ],
    [
      "a root that only ends like an excluded one",
      "packages/tools/scripts/make.ts",
      "export const f = defineErrors;\n",
      1,
    ],
    [
      "a src file an outside-src glob matches",
      "packages/core/auth/src/vitest.config.ts",
      "export const f = defineErrors;\n",
      1,
    ],
  ])("refuses the token in %s", async (_where, file, text, line) => {
    const outcome = await failure({ files: { [file]: text } });

    expect(outcome).toEqual({
      exitCode: 1,
      stderr: lines(
        `${file}:${String(line)}: names defineErrors, which only ${REGISTRY}/ may name in the rule's scope (R10)`
      ),
    });
  });

  it("does not read a file the rule's scope excludes: a test file, test code or configuration beside a source tree, a tooling root", async () => {
    plant({
      files: {
        "packages/core/auth/src/make.test.ts": 'import { defineErrors } from "../x.js";\n',
        "packages/core/auth/src/make.test.mts": 'import { defineErrors } from "../x.js";\n',
        "apps/api/tests/unit/make.ts": 'import { defineErrors } from "../x.js";\n',
        "packages/core/auth/vitest.config.ts": 'import { defineErrors } from "./x.js";\n',
        "scripts/.cache/make.ts": 'import { defineErrors } from "../x.js";\n',
      },
    });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("reads the token as a whole word", async () => {
    plant({
      files: {
        [ROGUE]: "export const redefineErrorsOnce = 1;\nexport const defineErrorsLater = 2;\n",
      },
    });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("R11: an of call reads only a table of ERROR_TABLES", () => {
  const refused = (file: string, line: number): string[] =>
    lines(
      `${file}:${String(line)}: an of call reads FAKE_ERRORS as its first argument, which is no table of ERROR_TABLES (R11)`
    );

  it.each([
    ["a member of a table", "export const e = RegisteredError.of(FAKE_ERRORS.X);\n", 1],
    ["a cause after it", "export const e = UseCaseError.of(FAKE_ERRORS.X, { cause });\n", 1],
    ["a cast", "export const e = RegisteredError.of((FAKE_ERRORS.X as never));\n", 1],
    ["a namespace", "export const e = RegisteredError.of(shared.FAKE_ERRORS.X);\n", 1],
    ["a computed member", 'export const e = RegisteredError.of(FAKE_ERRORS["X"]);\n', 1],
    ["the table itself", "export const e = RegisteredError.of(FAKE_ERRORS);\n", 1],
    ["a bare of", "export const e = of(FAKE_ERRORS.X);\n", 1],
    ["a call over two lines", "export const e = RegisteredError.of(\n  FAKE_ERRORS.X\n);\n", 1],
  ])("refuses a name that is no table, read as %s", async (_shape, text, line) => {
    const outcome = await failure({ files: { [ROGUE]: text } });

    expect(outcome).toEqual({ exitCode: 1, stderr: refused(ROGUE, line) });
  });

  it("reads the registry directory too", async () => {
    const file = `${REGISTRY}/registered-error.ts`;

    const outcome = await failure({
      files: { [file]: "export {};\nexport const e = RegisteredError.of(FAKE_ERRORS.X);\n" },
    });

    expect(outcome).toEqual({ exitCode: 1, stderr: refused(file, 2) });
  });

  it("passes a code whose own name ends in _ERRORS, a later argument, and an excluded file", async () => {
    plant({
      domains: [
        COMMON,
        {
          name: "auth",
          entries: {
            ...AUTH.entries,
            TOO_MANY_ERRORS: entry({
              category: "rate_limit",
              status: 429,
              message: "Too many errors",
            }),
          },
        },
      ],
      files: {
        [ROGUE]: "export const e = UseCaseError.of(COMMON_ERRORS.NOT_FOUND, FAKE_ERRORS.X);\n",
        "packages/core/auth/src/rogue.test.ts":
          "export const e = RegisteredError.of(FAKE_ERRORS.X);\n",
      },
    });

    const outcome = await scan();

    expect(outcome.stderr).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("fail-closed", () => {
  it("exits 3 when the root is not a directory", async () => {
    const missing = path.join(root, "missing");

    const outcome = await runGate({ root: missing, exclusions: EXCLUSIONS, history });

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: lines(`${missing}: is not a directory, so nothing was read`),
    });
  });

  it.each([
    ["not an array", { "errors/no-inline-error": [] }, "is an object, not an array"],
    ["empty", [], "is empty"],
    [
      "an entry with no glob",
      [{ kind: "test-suffix", reason: "Test files" }],
      "holds entry 0 with no glob string",
    ],
    [
      "an entry of an unknown kind",
      [{ glob: "scripts/**", kind: "outside src", reason: "Tooling" }],
      'holds entry 0 with the kind "outside src", which is none of test-suffix, declaration, outside-src and whole-root',
    ],
    [
      "a character class",
      [{ glob: "src/[ab].ts", kind: "whole-root" }],
      'holds the glob "src/[ab].ts", whose syntax the gate does not read (it reads *, ** and {a,b})',
    ],
    [
      "a negation",
      [{ glob: "!scripts/**", kind: "whole-root" }],
      'holds the glob "!scripts/**", whose syntax the gate does not read (it reads *, ** and {a,b})',
    ],
    [
      "an absolute path",
      [{ glob: "/scripts/**", kind: "whole-root" }],
      'holds the glob "/scripts/**", whose syntax the gate does not read (it reads *, ** and {a,b})',
    ],
    [
      "a nested brace",
      [{ glob: "a/*.{ts,{mts,cts}}", kind: "whole-root" }],
      'holds the glob "a/*.{ts,{mts,cts}}", whose syntax the gate does not read (it reads *, ** and {a,b})',
    ],
    [
      "a slash inside braces",
      [{ glob: "{a/b,c}/**", kind: "whole-root" }],
      'holds the glob "{a/b,c}/**", whose syntax the gate does not read (it reads *, ** and {a,b})',
    ],
  ])("exits 3 on an exclusion list that is %s", async (_what, exclusions, problem) => {
    plant();

    const outcome = await scan(exclusions);

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: lines(
        `${SCOPE_MODULE}: the exclusion list of errors/no-inline-error ${problem}, so the rule's scope cannot be told`
      ),
    });
  });

  it("exits 3 on fewer than two portals", async () => {
    const outcome = await failure({ portals: ["admin"] });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(`apps/: holds 1 portal (admin), ${PORTAL_FLOOR_LINE}`),
    });
  });

  it("does not count as a portal a directory with no routing file", async () => {
    const outcome = await failure({
      portals: ["admin"],
      files: { "apps/client/messages/en.json": "{}\n" },
    });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(`apps/: holds 1 portal (admin), ${PORTAL_FLOOR_LINE}`),
    });
  });

  it("exits 3 when domains/ does not exist", async () => {
    const outcome = await failure({ domains: [] });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(
        `${DOMAINS}/: does not exist, so no table was read`,
        `${INDEX}: ERROR_TABLES is empty, so no code was read`
      ),
    });
  });

  it("exits 3 when domains/ holds no domain file", async () => {
    mkdirSync(path.join(root, DOMAINS), { recursive: true });

    const outcome = await failure({ domains: [] });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(
        `${DOMAINS}/: holds no <name>.ts file, so no table was read`,
        `${INDEX}: ERROR_TABLES is empty, so no code was read`
      ),
    });
  });

  it("exits 3 when the registry cannot be loaded", async () => {
    const outcome = await failure({ tables: "export const ERROR_TABLES = [;\n" });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toMatch(
      /^error-registry-gate: packages\/shared\/src\/error-registry\/index\.ts: could not be loaded, so no code was read: \S/
    );
  });

  it.each([
    ["exports no ERROR_TABLES", { index: "export const TABLES = [];\n" }],
    [
      "ERROR_TABLES is an object, not an array of tables",
      { tables: "export const ERROR_TABLES = {};\n" },
    ],
    ["ERROR_TABLES is empty", { tables: "export const ERROR_TABLES = [];\n" }],
  ])("exits 3 when the index %s", async (problem, tree) => {
    const outcome = await failure(tree);

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(`${INDEX}: ${problem}, so no code was read`),
    });
  });

  it("exits 3 when a domain file cannot be loaded, naming it", async () => {
    const outcome = await failure({
      domains: [COMMON, { ...AUTH, source: "export const AUTH_ERRORS = {;\n" }],
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(2);
    expect(outcome.stderr[0]).toMatch(
      /^error-registry-gate: packages\/shared\/src\/error-registry\/index\.ts: could not be loaded, so no code was read: \S/
    );
    expect(outcome.stderr[1]).toMatch(
      /^error-registry-gate: packages\/shared\/src\/error-registry\/domains\/auth\.ts: could not be loaded, so its table was not read: \S/
    );
  });

  it("exits 3 when git ls-files fails", async () => {
    const outcome = await failure({ tracked: false });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toMatch(
      /^error-registry-gate: git ls-files: failed, so no tracked file was read: \S/
    );
  });

  it("exits 3 when git lists no source file of the rule's scope", async () => {
    plant();

    const outcome = await scan([{ glob: "**", kind: "whole-root", reason: "Everything" }]);

    expect(outcome).toEqual({
      exitCode: 3,
      stdout: [],
      stderr: lines(
        "git ls-files: lists no source file of the rule's scope, so R8, R10 and R11 read nothing"
      ),
    });
  });

  it("exits 3 when a tracked file of the scope cannot be read", async () => {
    plant();
    unlinkSync(path.join(root, REFERENCES));

    const outcome = await scan();

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
    expect(outcome.stderr[0]).toMatch(
      /^error-registry-gate: packages\/core\/auth\/src\/references\.ts: is tracked and could not be read, so R8, R10 and R11 read nothing: \S/
    );
  });

  it("exits 3 over 1, printing what it could not read before the verdict", async () => {
    const outcome = await failure({
      portals: ["admin"],
      domains: [COMMON, AUTH, { name: "billing", entries: { NOT_FOUND: entry({ fronts: [] }) } }],
    });

    expect(outcome).toEqual({
      exitCode: 3,
      stderr: lines(
        `apps/: holds 1 portal (admin), ${PORTAL_FLOOR_LINE}`,
        "NOT_FOUND: is in the tables of billing and common; a code is in one table (R3)"
      ),
    });
  });
});

describe("the process", () => {
  const run = (args: readonly string[]): { status: number; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT, ...args], { encoding: "utf8" });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  };

  it.each([
    [["--root"]],
    [["--root", ""]],
    [["--root", "a", "--root", "b"]],
    [["--write", "--write"]],
    [["--unknown"]],
  ])("exits 2 on the usage error %j", (args) => {
    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${USAGE}\n`);
  });

  it.each([
    [["--root", "<missing>"]],
    [["--root", "<missing>", "--write"]],
    [["--write", "--root", "<missing>"]],
  ])("exits 3 when the root is not a directory, having read nothing, given %j", (args) => {
    const missing = path.join(root, "missing");

    const result = run(args.map((arg) => (arg === "<missing>" ? missing : arg)));

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `error-registry-gate: ${missing}: is not a directory, so nothing was read\n`
    );
  });
});
