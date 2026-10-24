/**
 * @file dependencyLedger.test.ts
 * @description Pins the manifest side of the dependency-usage ledger,
 *   `scripts/testing/lib/dependency-manifests.mjs`: the workspace manifests the `packages:` globs
 *   reach and their agreement with the legal scan of `scripts/legal/subprocessors.mjs`, the
 *   catalogs of `pnpm-workspace.yaml` and the specifier kind of a declaration, the `bin` names of
 *   an installed package, the command lines a binary runs from, and the binary and stylesheet
 *   sites of a declared name. Each case runs over a tree planted in a fresh directory under
 *   `tmpdir()`, with the tracked files handed in as a list, so nothing is spawned and the
 *   repository is read for its workspace manifest only.
 *
 *   Then the ledger's core, `scripts/testing/lib/dependency-ledger-core.mjs`, over rows built from
 *   literal inputs: the rows the readers' outputs join into, the real-site rule and the floor, the
 *   owner's decisions and every rule they are held to, the summary, and the deterministic JSON the
 *   ledger renders to. Only the decisions file is planted on disk, for the one reader of it.
 *
 *   Last, the command, `scripts/testing/dependency-ledger.mjs`, through `main(argv, seams)` over
 *   a planted repository with the git listing replaced: write mode, `--sites`, the ledger's own
 *   files, and the exit code of every class (0 written, 1 a problem, 2 usage, 3 an unread input,
 *   3 over 1), twice as a spawned script.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Result<T> = { value: T } | { error: string };

/** The catalogs of a workspace manifest: the default one and each named one. */
interface Catalogs {
  readonly default: ReadonlySet<string>;
  readonly named: ReadonlyMap<string, ReadonlySet<string>>;
}

/** One declaration of a manifest, as the legal scan returns it. */
interface Declaration {
  readonly file: string;
  readonly block: string;
  readonly name: string;
  readonly spec: string;
}

/** One site of a declared name in one file. */
interface Site {
  readonly name: string;
  readonly kind: string;
  readonly file: string;
}

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type ManifestsModule = {
  workspaceManifests: (text: string, tracked: readonly string[]) => Result<string[]>;
  manifestDisagreement: (derived: readonly string[], legal: readonly string[]) => string | null;
  readCatalogs: (text: string) => Result<Catalogs>;
  specifierKindOf: (spec: string, catalogs: Catalogs, name: string) => Result<string>;
  readBins: (root: string, manifestDir: string, name: string) => Result<string[]>;
  declaredBins: (
    root: string,
    declarations: readonly Declaration[],
    name: string
  ) => Result<string[] | null>;
  binaryTexts: (root: string, tracked: readonly string[]) => Result<Array<[string, string]>>;
  binarySites: (
    name: string,
    bins: readonly string[],
    texts: ReadonlyArray<readonly [string, string]>
  ) => Site[];
  cssSites: (
    root: string,
    tracked: readonly string[],
    declared: ReadonlySet<string>
  ) => Result<Site[]>;
};

/** The legal scan's surface, as far as this suite reads it. */
type LegalModule = {
  scanManifests: (
    root: string,
    listed?: string[]
  ) => { manifests: string[]; names: ReadonlyMap<string, unknown> };
};

type PathClass = "production" | "test" | "config";
type Scope = "production" | "dev-only";
type Verdict = "above-floor" | "under-floor";
/** A row's sites: kind, then path class, then the files. */
type Sites = Readonly<Record<string, Readonly<Partial<Record<PathClass, readonly string[]>>>>>;

/** One declaration of a row, its specifier read as a kind. */
interface RowDeclaration {
  readonly manifest: string;
  readonly block: string;
  readonly specifier: string;
}

/** What the real-site rule reads of a row. */
interface Counted {
  readonly scope: Scope;
  readonly typedTarget: string | null;
  readonly sites: Sites;
}

/** One declared name with everything the readers found for it, counted against the floor. */
interface Row extends Counted {
  readonly name: string;
  readonly declarations: readonly RowDeclaration[];
  readonly bins: readonly string[] | null;
  readonly real: number;
  readonly verdict: Verdict;
}

/** What the legal scan says of one name. */
interface Declared {
  readonly production: boolean;
}

/** The legal scan's names and declarations. */
interface Scan {
  readonly names: ReadonlyMap<string, Declared>;
  readonly declarations: readonly Declaration[];
}

/** What the readers hand the core. */
interface RowsInput {
  readonly scan: Scan;
  readonly catalogs: Catalogs;
  readonly sites: readonly Site[];
  readonly css: Result<Site[]>;
  readonly bins: ReadonlyMap<string, Result<string[] | null>>;
  readonly workspaceDirs: readonly string[];
}

type Fields = Readonly<Record<string, unknown>>;

/** The owner's decisions, as the core reads them. */
interface Decisions {
  readonly entries: ReadonlyMap<string, unknown>;
  readonly pendingBaseline: number;
  readonly floor: unknown;
  readonly problems: readonly string[];
}

/** A row with its decision. */
interface JoinedRow extends Row {
  readonly decision: string | null;
}

/** What joining the decisions returns. */
interface Joined {
  readonly rows: readonly JoinedRow[];
  readonly problems: readonly string[];
  readonly pending: number;
}

/** A row of the rendered ledger. */
interface LedgerRow {
  readonly name: string;
  readonly scope: Scope;
  readonly typedTarget: string | null;
  readonly declarations: readonly RowDeclaration[];
  readonly bins: readonly string[] | null;
  readonly verdict: Verdict;
  readonly real: number | null;
  readonly decision: string | null;
  readonly sites: Sites | null;
}

/** The counts of the ledger. */
interface Summary {
  readonly names: number;
  readonly production: number;
  readonly devOnly: number;
  readonly types: number;
  readonly aboveFloor: number;
  readonly underFloor: number;
  readonly atZero: number;
  readonly underFloorWithSites: number;
  readonly kept: number;
  readonly remove: number;
  readonly pending: number;
}

/** The ledger the core renders. */
interface Ledger {
  readonly version: number;
  readonly floor: number;
  readonly summary: Summary;
  readonly names: readonly LedgerRow[];
}

/** The core's surface, typed for the same reason as the manifests module's. */
type CoreModule = {
  realSitesOf: (row: Counted) => number;
  verdictOf: (real: number) => Verdict;
  buildRows: (input: RowsInput) => Result<Row[]>;
  loadDecisions: (root: string) => Result<Decisions>;
  joinDecisions: (rows: readonly Row[], decisions: Decisions) => Joined;
  summarize: (rows: readonly LedgerRow[]) => Summary;
  buildLedger: (
    rows: readonly Row[],
    decisions: Decisions
  ) => { ledger: Ledger; problems: string[] };
  render: (ledger: Ledger) => Promise<string>;
};

/** What the command prints and the code it exits with. */
interface CliResult {
  readonly code: number;
  readonly output: string;
}

/** What the suite replaces in the command: the git listing. */
interface CommandSeams {
  readonly listFiles?: (root: string) => Result<string[]>;
  readonly render?: (ledger: Ledger) => Promise<string>;
}

/** The command's surface, typed for the same reason as the core's. */
type CommandModule = {
  main: (argv: readonly string[], seams?: CommandSeams) => Promise<CliResult>;
  LEDGER_FILES: readonly string[];
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const MANIFESTS_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-manifests.mjs");
const LEGAL = path.join(REPO_ROOT, "scripts/legal/subprocessors.mjs");
const CORE_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-ledger-core.mjs");
const COMMAND = path.join(REPO_ROOT, "scripts/testing/dependency-ledger.mjs");
const manifests = (await import(MANIFESTS_LIB)) as ManifestsModule;
const { scanManifests } = (await import(LEGAL)) as LegalModule;
const core = (await import(CORE_LIB)) as CoreModule;
const cli = (await import(COMMAND)) as CommandModule;

/** The repository's own workspace manifest, so the planted tree reads the real `packages:` globs. */
const WORKSPACE_TEXT = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
const WORKSPACE = "pnpm-workspace.yaml";

/** One manifest per kind of glob the workspace manifest holds, a nested core package among them. */
const PLANTED_MANIFESTS = [
  "package.json",
  "apps/api/package.json",
  "infra/prisma/package.json",
  "packages/core/x/package.json",
  "packages/providers/p/package.json",
  "packages/ui/package.json",
];

const CATALOG_TEXT = [
  "packages:",
  "  - apps/*",
  "",
  "catalog:",
  "  # the React family",
  "  react: 19.2.7 # moves with react-dom",
  '  "@types/react": 19.2.17',
  "",
  "catalogs:",
  "  # the OpenTelemetry set",
  "  otel:",
  '    "@opentelemetry/api": 1.9.1',
  '    "@opentelemetry/core": 2.8.0 # the floor',
  "overrides:",
  "  lodash: 4.18.1",
  "",
].join("\n");

let root = "";

const put = (file: string, data: unknown): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), typeof data === "string" ? data : JSON.stringify(data));
};

const valueOf = <T>(result: Result<T>): T => {
  if ("error" in result) throw new Error(result.error);
  return result.value;
};

const errorOf = <T>(result: Result<T>): string => ("error" in result ? result.error : "");

const plantWorkspace = (text: string, files: readonly string[]): void => {
  put(WORKSPACE, text);
  files.forEach((file) => put(file, { name: `@w/${path.dirname(file)}` }));
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "dependency-ledger-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspaceManifests and manifestDisagreement", () => {
  it("returns the root and every manifest a packages: glob reaches, the legal scan's set", () => {
    plantWorkspace(WORKSPACE_TEXT, PLANTED_MANIFESTS);
    const tracked = [...PLANTED_MANIFESTS, "apps/api/src/index.ts", WORKSPACE];

    const derived = valueOf(manifests.workspaceManifests(WORKSPACE_TEXT, tracked));

    expect(derived).toEqual(PLANTED_MANIFESTS);
    expect(manifests.manifestDisagreement(derived, scanManifests(root).manifests)).toBeNull();
  });

  it("returns the manifests each side holds alone when the globs and the legal scan disagree", () => {
    const deep = "apps/api/fixtures/package.json";
    const outside = "tools/x/package.json";
    const text = `${WORKSPACE_TEXT}\n`.replace("  - infra/*\n", "  - infra/*\n  - tools/*\n");
    plantWorkspace(text, [...PLANTED_MANIFESTS, deep, outside]);
    const derived = valueOf(
      manifests.workspaceManifests(text, [...PLANTED_MANIFESTS, deep, outside])
    );

    const disagreement = manifests.manifestDisagreement(derived, scanManifests(root).manifests);

    expect(derived).toContain(outside);
    expect(derived).not.toContain(deep);
    expect(disagreement).toContain(`only the workspace globs reach ${outside}`);
    expect(disagreement).toContain(`only the legal scan reads ${deep}`);
  });

  it("returns no manifest a negated glob names", () => {
    const files = ["package.json", "packages/a/package.json", "packages/skip/package.json"];
    const text = 'packages:\n  - packages/*\n  - "!packages/skip"\n';
    plantWorkspace(text, files);

    const derived = valueOf(manifests.workspaceManifests(text, files));

    expect(derived).toEqual(["package.json", "packages/a/package.json"]);
  });

  it.each<[string, string, string]>([
    ["no packages: block", "catalog:\n  react: 19.2.7\n", `${WORKSPACE} has no packages: block`],
    ["a glob line it cannot read", "packages:\n  apps/*\n", 'cannot read "apps/*"'],
  ])("returns an error for %s", (_case, text, expected) => {
    const result = manifests.workspaceManifests(text, ["package.json"]);

    expect(errorOf(result)).toContain(expected);
  });
});

describe("readCatalogs and specifierKindOf", () => {
  it("returns the default catalog and each named one, past comments and quoted keys", () => {
    const catalogs = valueOf(manifests.readCatalogs(CATALOG_TEXT));

    expect([...catalogs.default]).toEqual(["react", "@types/react"]);
    expect([...catalogs.named.keys()]).toEqual(["otel"]);
    expect([...(catalogs.named.get("otel") ?? [])]).toEqual([
      "@opentelemetry/api",
      "@opentelemetry/core",
    ]);
  });

  it("returns empty catalogs for a manifest that declares none", () => {
    const catalogs = valueOf(manifests.readCatalogs("packages:\n  - apps/*\n"));

    expect(catalogs.default.size).toBe(0);
    expect(catalogs.named.size).toBe(0);
  });

  it.each<[string, string, string]>([
    ["an entry with no colon", "catalog:\n  react 19.2.7\n", 'cannot read "react 19.2.7"'],
    ["an entry before any named catalog", 'catalogs:\n    "@x/y": 1.0.0\n', '"@x/y": 1.0.0'],
    ["a line a named catalog cannot hold", "catalogs:\n  otel:\n  - x\n", 'cannot read "- x"'],
  ])("returns an error for %s", (_case, text, expected) => {
    expect(errorOf(manifests.readCatalogs(text))).toContain(expected);
  });

  it.each<[string, string, string]>([
    ["catalog:", "react", "catalog"],
    ["catalog:default", "@types/react", "catalog"],
    ["catalog:otel", "@opentelemetry/core", "catalog:otel"],
    ["1.2.3", "lodash", "literal"],
    ["^4.0.0", "lodash", "literal"],
  ])("returns the kind of %s for %s as %s", (spec, name, expected) => {
    const catalogs = valueOf(manifests.readCatalogs(CATALOG_TEXT));

    expect(valueOf(manifests.specifierKindOf(spec, catalogs, name))).toBe(expected);
  });

  it.each<[string, string, string]>([
    ["catalog:nope", "react", "catalog:nope names a catalog"],
    ["catalog:", "missing", "the default catalog holds no missing"],
    ["catalog:otel", "react", "the otel catalog holds no react"],
  ])("returns an error for %s declaring %s", (spec, name, expected) => {
    const catalogs = valueOf(manifests.readCatalogs(CATALOG_TEXT));

    expect(errorOf(manifests.specifierKindOf(spec, catalogs, name))).toContain(expected);
  });
});

describe("readBins and declaredBins", () => {
  beforeEach(() => {
    put("apps/api/node_modules/@s/tool/package.json", { name: "@s/tool", bin: "cli.js" });
    put("node_modules/multi/package.json", { name: "multi", bin: { zeta: "z.js", alpha: "a.js" } });
    put("node_modules/lib/package.json", { name: "lib" });
    put("packages/ui/node_modules/@s/tool/package.json", { name: "@s/tool", bin: "cli.js" });
    put("node_modules/broken/package.json", "{");
  });

  it.each<[string, string, string[]]>([
    ["apps/api", "@s/tool", ["tool"]],
    [".", "multi", ["alpha", "zeta"]],
    [".", "lib", []],
  ])("returns the bin names of the copy %s installs for %s", (manifestDir, name, expected) => {
    expect(valueOf(manifests.readBins(root, manifestDir, name))).toEqual(expected);
  });

  it.each<[string, string, string]>([
    ["apps/api", "absent", "apps/api/package.json declares absent, and its installed copy cannot"],
    [".", "broken", "package.json declares broken, and its installed copy cannot be read"],
  ])("returns an error when the copy %s installs for %s cannot be read", (dir, name, expected) => {
    expect(errorOf(manifests.readBins(root, dir, name))).toContain(expected);
  });

  it("returns the bins of the first declaring manifest that is no peer, and null for a peer only", () => {
    const peer = { file: "apps/api/package.json", block: "peerDependencies", spec: "1" };
    const dev = { file: "packages/ui/package.json", block: "devDependencies", spec: "1" };

    const declaredByBoth = manifests.declaredBins(
      root,
      [
        { ...peer, name: "@s/tool" },
        { ...dev, name: "@s/tool" },
      ],
      "@s/tool"
    );
    const peerOnly = manifests.declaredBins(root, [{ ...peer, name: "react" }], "react");

    expect(valueOf(declaredByBoth)).toEqual(["tool"]);
    expect(valueOf(peerOnly)).toBeNull();
  });
});

describe("binaryTexts", () => {
  it("returns the manifest scripts, the root lint-staged, and hooks, workflows, actions and shell scripts without their comment lines", () => {
    put("package.json", {
      scripts: { lint: "eslint .", prepare: "husky", nothing: 1 },
      "lint-staged": { "*.ts": ["prettier --write", "eslint --fix"], "*.md": "prettier --write" },
    });
    put("apps/api/package.json", { name: "@w/api", scripts: { gen: "prisma generate" } });
    put("packages/ui/package.json", { name: "@w/ui", "lint-staged": { "*.ts": "ignored" } });
    put(
      ".husky/pre-commit",
      "#!/usr/bin/env sh\n# prettier runs on the staged files\npnpm exec lint-staged\n"
    );
    put(
      ".github/workflows/ci.yml",
      "  # turbo builds every workspace\nrun: pnpm exec turbo run build\n"
    );
    put(".github/actions/setup/action.yml", "run: pnpm install\n");
    put("scripts/run.sh", "tsx scripts/x.ts\n");
    const ignored = ["apps/api/src/index.ts", ".github/dependabot.yml", ".husky/hooks/extra"];
    ignored.forEach((file) => put(file, "turbo\n"));
    const tracked = [
      "scripts/run.sh",
      "package.json",
      "apps/api/package.json",
      "packages/ui/package.json",
      ".husky/pre-commit",
      ".github/workflows/ci.yml",
      ".github/actions/setup/action.yml",
      ...ignored,
    ];

    const texts = valueOf(manifests.binaryTexts(root, tracked));

    expect(texts).toEqual([
      [".github/actions/setup/action.yml", "run: pnpm install\n"],
      [".github/workflows/ci.yml", "run: pnpm exec turbo run build\n"],
      [".husky/pre-commit", "pnpm exec lint-staged\n"],
      ["apps/api/package.json", "prisma generate"],
      ["package.json", "eslint .\nhusky\nprettier --write\neslint --fix\nprettier --write"],
      ["scripts/run.sh", "tsx scripts/x.ts\n"],
    ]);
  });

  it.each<[string, string, string | null, string]>([
    ["a tracked source that is gone", "scripts/gone.sh", null, "scripts/gone.sh could not be read"],
    [
      "a manifest that is no JSON",
      "apps/api/package.json",
      "{",
      "apps/api/package.json is not JSON",
    ],
  ])("returns an error for %s", (_case, file, text, expected) => {
    if (text !== null) put(file, text);

    const result = manifests.binaryTexts(root, [file]);

    expect(errorOf(result)).toContain(expected);
  });
});

describe("binarySites", () => {
  const TEXTS: ReadonlyArray<readonly [string, string]> = [
    [".github/workflows/ci.yml", "run: pnpm exec depcruise src --config .dependency-cruiser.cjs"],
    ["apps/api/package.json", "prisma generate\ntsx watch src/index.ts"],
    ["package.json", "husky\nprisma-client generate"],
    ["scripts/a.sh", 'NODE_OPTIONS="--import=tsx" node x.ts'],
    ["scripts/b.sh", "tsxfoo run\n./prisma/seed"],
    ["scripts/c.sh", "cat .dependency-cruiser.cjs schema.prisma"],
  ];

  it.each<[string, string[], string[]]>([
    ["prisma", ["prisma"], ["apps/api/package.json"]],
    ["tsx", ["tsx"], ["apps/api/package.json", "scripts/a.sh"]],
    ["husky", ["husky"], ["package.json"]],
    ["dependency-cruiser", ["depcruise", "dependency-cruiser"], [".github/workflows/ci.yml"]],
    ["lib", [], []],
  ])("returns the files whose command lines run %s's bins %j", (name, bins, files) => {
    const sites = manifests.binarySites(name, bins, TEXTS);

    expect(sites).toEqual(files.map((file) => ({ name, kind: "binary", file })));
  });
});

describe("cssSites", () => {
  const CLIENT_CSS = "apps/client/app/globals.css";
  const ADMIN_CSS = "apps/admin/app/globals.css";
  const DECLARED = new Set([
    "tailwindcss",
    "tw-animate-css",
    "@fontsource/inter",
    "@tailwindcss/typography",
    "tailwind-config",
    "pkg-src",
    "commented-out",
  ]);

  it("returns the declared packages a stylesheet imports or loads as a plugin or config", () => {
    put(
      CLIENT_CSS,
      [
        '@import "tailwindcss";',
        "@import 'tw-animate-css';",
        '@import url("@fontsource/inter/400.css");',
        '@import "./local.css";',
        '@plugin "@tailwindcss/typography";',
        '@config "tailwind-config/base.js";',
        '@source "pkg-src";',
        '/* @import "commented-out"; */',
        '@import "undeclared-pkg";',
      ].join("\n")
    );
    put(ADMIN_CSS, '@import "tailwindcss";\n');
    put("docs/style.md", '@import "tw-animate-css";\n');

    const sites = valueOf(
      manifests.cssSites(root, [CLIENT_CSS, ADMIN_CSS, "docs/style.md"], DECLARED)
    );

    expect(sites).toEqual([
      { name: "@fontsource/inter", kind: "css", file: CLIENT_CSS },
      { name: "@tailwindcss/typography", kind: "css", file: CLIENT_CSS },
      { name: "tailwind-config", kind: "css", file: CLIENT_CSS },
      { name: "tailwindcss", kind: "css", file: ADMIN_CSS },
      { name: "tailwindcss", kind: "css", file: CLIENT_CSS },
      { name: "tw-animate-css", kind: "css", file: CLIENT_CSS },
    ]);
  });

  it("returns an error for a tracked stylesheet that cannot be read", () => {
    const result = manifests.cssSites(root, ["apps/client/app/gone.scss"], DECLARED);

    expect(errorOf(result)).toContain("apps/client/app/gone.scss could not be read");
  });
});

/** `count` files under `dir`, named apart. */
const filesUnder = (dir: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${dir}/f${String(index)}.ts`);

const ABOVE: Sites = { "runtime-import": { production: filesUnder("apps/api/src", 3) } };

describe("realSitesOf", () => {
  it.each<[string, Scope, string | null, Sites, number]>([
    ["a production name three production files import", "production", null, ABOVE, 3],
    [
      "a production name two production files import",
      "production",
      null,
      { "runtime-import": { production: filesUnder("apps/api/src", 2) } },
      2,
    ],
    [
      "a production name only tests import and config strings name",
      "production",
      null,
      {
        "runtime-import": { test: filesUnder("apps/api/tests", 5) },
        "config-string": { config: filesUnder("scripts", 2) },
      },
      0,
    ],
    [
      "a production name a production and a config stylesheet load",
      "production",
      null,
      { css: { production: ["apps/client/app/globals.css"], config: ["styles/base.css"] } },
      1,
    ],
    [
      "a production name only run as a binary",
      "production",
      null,
      { binary: { config: filesUnder(".github", 3) } },
      0,
    ],
    [
      "a production name imported and loaded as a stylesheet by the same file",
      "production",
      null,
      { "runtime-import": { production: ["apps/a.ts"] }, css: { production: ["apps/a.ts"] } },
      1,
    ],
    [
      "a dev-only name two tests import and one script runs",
      "dev-only",
      null,
      {
        "runtime-import": { test: ["apps/api/tests/a.test.ts", "apps/api/tests/b.test.ts"] },
        binary: { config: ["package.json"] },
      },
      3,
    ],
    [
      "a dev-only name three production files import",
      "dev-only",
      null,
      { "runtime-import": { production: filesUnder("apps/api/src", 3) } },
      3,
    ],
    [
      "a dev-only name three test scripts run as a binary",
      "dev-only",
      null,
      { binary: { test: filesUnder("performance/scripts", 3) } },
      3,
    ],
    [
      "a dev-only name config strings name in production files and one config file",
      "dev-only",
      null,
      {
        "config-string": {
          production: filesUnder("apps/api/src", 2),
          config: ["vitest.config.ts"],
        },
      },
      1,
    ],
    [
      "a dev-only name stylesheets of every class load",
      "dev-only",
      null,
      { css: { production: ["a.css"], test: ["b.css"], config: ["c.css"] } },
      3,
    ],
    [
      "an @types row with three type-only files of its target",
      "dev-only",
      "x",
      { "type-only": { production: ["a.ts"], test: ["b.ts"], config: ["c.ts"] } },
      3,
    ],
    [
      "an @types row whose only sites are runtime imports",
      "dev-only",
      "x",
      { "runtime-import": { production: filesUnder("apps/api/src", 3) } },
      0,
    ],
    [
      "a name that is only type-imported",
      "production",
      null,
      { "type-only": { production: filesUnder("apps/api/src", 3) } },
      0,
    ],
    [
      "a name that is only mocked",
      "dev-only",
      null,
      { "test-mock": { test: filesUnder("apps/api/tests", 4) } },
      0,
    ],
  ])("returns the real sites of %s", (_case, scope, typedTarget, sites, expected) => {
    expect(core.realSitesOf({ scope, typedTarget, sites })).toBe(expected);
  });
});

describe("verdictOf", () => {
  it.each<[number, Verdict]>([
    [0, "under-floor"],
    [2, "under-floor"],
    [3, "above-floor"],
    [4, "above-floor"],
  ])("returns %s real sites as %s", (real, expected) => {
    expect(core.verdictOf(real)).toBe(expected);
  });
});

describe("buildRows", () => {
  const input = (overrides: Partial<RowsInput> = {}): RowsInput => ({
    scan: {
      names: new Map([
        ["prod-a", { production: true }],
        ["dev-a", { production: false }],
        ["@types/x", { production: false }],
        ["peer-a", { production: true }],
      ]),
      declarations: [
        { file: "apps/api/package.json", block: "devDependencies", name: "prod-a", spec: "^2.0.0" },
        { file: "package.json", block: "devDependencies", name: "dev-a", spec: "catalog:otel" },
        { file: "apps/api/package.json", block: "dependencies", name: "prod-a", spec: "catalog:" },
        { file: "package.json", block: "devDependencies", name: "@types/x", spec: "1.0.0" },
        { file: "packages/x/package.json", block: "peerDependencies", name: "peer-a", spec: "^1" },
      ],
    },
    catalogs: { default: new Set(["prod-a"]), named: new Map([["otel", new Set(["dev-a"])]]) },
    sites: [
      { name: "prod-a", kind: "runtime-import", file: "apps/api/src/b.ts" },
      { name: "prod-a", kind: "test-mock", file: "apps/api/tests/a.test.ts" },
      { name: "prod-a", kind: "runtime-import", file: "apps/api/src/a.ts" },
      { name: "dev-a", kind: "binary", file: "package.json" },
      { name: "@types/x", kind: "type-only", file: "apps/api/src/a.ts" },
    ],
    css: { value: [{ name: "prod-a", kind: "css", file: "apps/api/src/style.css" }] },
    bins: new Map<string, Result<string[] | null>>([
      ["prod-a", { value: [] }],
      ["dev-a", { value: ["dev-a"] }],
      ["@types/x", { value: [] }],
      ["peer-a", { value: null }],
    ]),
    workspaceDirs: ["apps/api", "packages/x"],
    ...overrides,
  });

  it("returns one row per name in the scan's order, its declarations, bins, sites by class, real sites and verdict", () => {
    const rows = valueOf(core.buildRows(input()));

    expect(rows).toEqual([
      {
        name: "prod-a",
        scope: "production",
        typedTarget: null,
        declarations: [
          { manifest: "apps/api/package.json", block: "devDependencies", specifier: "literal" },
          { manifest: "apps/api/package.json", block: "dependencies", specifier: "catalog" },
        ],
        bins: [],
        sites: {
          "runtime-import": { production: ["apps/api/src/b.ts", "apps/api/src/a.ts"] },
          "test-mock": { test: ["apps/api/tests/a.test.ts"] },
          css: { production: ["apps/api/src/style.css"] },
        },
        real: 3,
        verdict: "above-floor",
      },
      {
        name: "dev-a",
        scope: "dev-only",
        typedTarget: null,
        declarations: [
          { manifest: "package.json", block: "devDependencies", specifier: "catalog:otel" },
        ],
        bins: ["dev-a"],
        sites: { binary: { config: ["package.json"] } },
        real: 1,
        verdict: "under-floor",
      },
      {
        name: "@types/x",
        scope: "dev-only",
        typedTarget: "x",
        declarations: [
          { manifest: "package.json", block: "devDependencies", specifier: "literal" },
        ],
        bins: [],
        sites: { "type-only": { production: ["apps/api/src/a.ts"] } },
        real: 1,
        verdict: "under-floor",
      },
      {
        name: "peer-a",
        scope: "production",
        typedTarget: null,
        declarations: [
          { manifest: "packages/x/package.json", block: "peerDependencies", specifier: "literal" },
        ],
        bins: null,
        sites: {},
        real: 0,
        verdict: "under-floor",
      },
    ]);
  });

  const scanWith = (declaration: Declaration): Scan => ({
    names: new Map([["prod-a", { production: true }]]),
    declarations: [declaration],
  });
  const PROD: Declaration = {
    file: "apps/api/package.json",
    block: "dependencies",
    name: "prod-a",
    spec: "1.0.0",
  };
  const ONLY_PROD = {
    scan: scanWith(PROD),
    sites: [],
    css: { value: [] },
    bins: new Map<string, Result<string[] | null>>([["prod-a", { value: [] }]]),
  };

  it.each<[string, Partial<RowsInput>, string]>([
    [
      "a catalog reference the catalogs do not hold",
      { ...ONLY_PROD, scan: scanWith({ ...PROD, spec: "catalog:nope" }) },
      "catalog:nope names a catalog",
    ],
    [
      "bins whose installed copy could not be read",
      { ...ONLY_PROD, bins: new Map([["prod-a", { error: "copy unread" }]]) },
      "copy unread",
    ],
    [
      "a name whose bins were never read",
      { ...ONLY_PROD, bins: new Map<string, Result<string[] | null>>() },
      "no bins were read for prod-a",
    ],
    [
      "stylesheets that could not be read",
      { ...ONLY_PROD, css: { error: "css unread" } },
      "css unread",
    ],
    [
      "a site of a name no manifest declares",
      { ...ONLY_PROD, sites: [{ name: "ghost", kind: "runtime-import", file: "a.ts" }] },
      "a.ts holds a runtime-import site of ghost, which no manifest declares",
    ],
    [
      "a binary site of a name with no bins",
      { ...ONLY_PROD, sites: [{ name: "prod-a", kind: "binary", file: "a.sh" }] },
      "prod-a has binary sites but no bins",
    ],
  ])("returns an error for %s", (_case, overrides, expected) => {
    expect(errorOf(core.buildRows(input(overrides)))).toContain(expected);
  });
});

/** A row of literal sites, declared once by `apps/api`, counted against the floor by the core. */
const rowOf = (
  name: string,
  scope: Scope,
  sites: Sites,
  typedTarget: string | null = null
): Row => {
  const real = core.realSitesOf({ scope, typedTarget, sites });
  return {
    name,
    scope,
    typedTarget,
    declarations: [
      {
        manifest: "apps/api/package.json",
        block: scope === "production" ? "dependencies" : "devDependencies",
        specifier: "literal",
      },
    ],
    bins: [],
    sites,
    real,
    verdict: core.verdictOf(real),
  };
};

const decisionsOf = (
  entries: Readonly<Record<string, unknown>> = {},
  pendingBaseline = 0,
  floor: unknown = 3
): Decisions => ({
  entries: new Map(Object.entries(entries)),
  pendingBaseline,
  floor,
  problems: [],
});

const KEPT: Fields = {
  status: "kept",
  grounds: "single-adapter",
  utility: "The one SDK of its adapter.",
  replacement: "None in the tree.",
  decidedOn: "2026-10-25",
  note: "N.",
};
const REMOVE: Fields = {
  status: "remove",
  utility: "None left.",
  replacement: "The native reader.",
  decidedOn: "2026-10-25",
  note: "N.",
};
const PENDING: Fields = { status: "pending", note: "Decided with its owner." };
const ONE: Sites = { "runtime-import": { production: ["apps/api/src/one.ts"] } };

describe("loadDecisions", () => {
  const FILE = "scripts/testing/dependency-decisions.json";
  const GENERATOR = "scripts/testing/dependency-ledger.mjs";
  const plant = (data: unknown): void => put(FILE, data);

  it("returns the entries, the baseline and the floor of a well-formed file", () => {
    plant({ generator: GENERATOR, floor: 3, pendingBaseline: 1, entries: { b: PENDING, a: KEPT } });

    const decisions = valueOf(core.loadDecisions(root));

    expect([...decisions.entries.keys()]).toEqual(["a", "b"]);
    expect(decisions.entries.get("a")).toEqual(KEPT);
    expect(decisions.pendingBaseline).toBe(1);
    expect(decisions.floor).toBe(3);
    expect(decisions.problems).toEqual([]);
  });

  it("returns no problem for a pending entry with no note", () => {
    plant({
      generator: GENERATOR,
      floor: 3,
      pendingBaseline: 1,
      entries: { a: { status: "pending" } },
    });

    const decisions = valueOf(core.loadDecisions(root));

    expect(decisions.problems).toEqual([]);
  });

  it.each<[string, () => void, string]>([
    ["a missing file", () => undefined, `${FILE} is missing or empty`],
    ["a file that is no JSON", () => plant("{"), `${FILE} is not JSON`],
  ])("returns an error for %s, never an empty set of decisions", (_case, setUp, expected) => {
    setUp();

    expect(errorOf(core.loadDecisions(root))).toContain(expected);
  });

  it.each<[string, Fields, string]>([
    ["an unknown top-level key", { flor: 3 }, `${FILE} has unknown keys flor`],
    [
      "a generator that is not the command",
      { generator: "x.mjs" },
      `${FILE}: generator "x.mjs" is not ${GENERATOR}`,
    ],
    [
      "an entry with an unknown key",
      { entries: { a: { ...KEPT, why: "?" } } },
      "a has unknown keys why",
    ],
    [
      "a status outside the three",
      { entries: { a: { ...PENDING, status: "decide" } } },
      'a has status "decide", not kept|remove|pending',
    ],
    [
      "a kept entry with no note",
      { entries: { a: { ...KEPT, note: undefined } } },
      "a has no note",
    ],
  ])("returns a problem for %s", (_case, overrides, expected) => {
    plant({ generator: GENERATOR, floor: 3, pendingBaseline: 0, entries: {}, ...overrides });

    const decisions = valueOf(core.loadDecisions(root));

    expect(decisions.problems.join("\n")).toContain(expected);
  });

  it("returns problems, and no floor, for a top level that is no object", () => {
    plant("null");

    const decisions = valueOf(core.loadDecisions(root));

    expect(decisions.floor).toBeNull();
    expect(decisions.entries.size).toBe(0);
    expect(decisions.problems).toEqual([
      `${FILE} holds no object of entries`,
      `${FILE}: pendingBaseline is not a non-negative integer`,
      `${FILE}: generator null is not ${GENERATOR}`,
    ]);
  });
});

describe("joinDecisions", () => {
  it("returns pending for an under-floor name with no entry, the entry's status otherwise, and remove or nothing above the floor", () => {
    const rows = [
      rowOf("under-a", "production", {}),
      rowOf("under-b", "production", ONE),
      rowOf("under-c", "production", ONE),
      rowOf("under-d", "production", ONE),
      rowOf("above-a", "production", ABOVE),
      rowOf("above-b", "production", ABOVE),
    ];
    const decisions = decisionsOf(
      { "under-b": KEPT, "under-c": REMOVE, "under-d": PENDING, "above-b": REMOVE },
      2
    );

    const joined = core.joinDecisions(rows, decisions);

    expect(joined.problems).toEqual([]);
    expect(joined.pending).toBe(2);
    expect(joined.rows.map((row) => [row.name, row.decision])).toEqual([
      ["under-a", "pending"],
      ["under-b", "kept"],
      ["under-c", "remove"],
      ["under-d", "pending"],
      ["above-a", null],
      ["above-b", "remove"],
    ]);
  });

  it("returns no problem for a remove entry that names its slice", () => {
    const joined = core.joinDecisions(
      [rowOf("u", "production", ONE)],
      decisionsOf({ u: { ...REMOVE, slice: "2.B-1" } })
    );

    expect(joined.problems).toEqual([]);
  });

  const without = (entry: Fields, field: string): Fields =>
    Object.fromEntries(Object.entries(entry).filter(([key]) => key !== field));

  it.each<[string, Fields, string]>([
    ["a kept entry with no grounds", without(KEPT, "grounds"), "u: a kept entry needs grounds"],
    ["a kept entry with no utility", without(KEPT, "utility"), "u: a kept entry needs utility"],
    [
      "a kept entry with no replacement",
      without(KEPT, "replacement"),
      "u: a kept entry needs replacement",
    ],
    [
      "a kept entry with no decidedOn",
      without(KEPT, "decidedOn"),
      "u: a kept entry needs decidedOn",
    ],
    [
      "a kept entry with a slice",
      { ...KEPT, slice: "2.B-1" },
      "u: a kept entry never carries slice",
    ],
    [
      "grounds outside the eight",
      { ...KEPT, grounds: "habit" },
      'u has grounds "habit", not single-adapter|',
    ],
    [
      "a remove entry with no utility",
      without(REMOVE, "utility"),
      "u: a remove entry needs utility",
    ],
    [
      "a remove entry with no replacement",
      without(REMOVE, "replacement"),
      "u: a remove entry needs replacement",
    ],
    [
      "a remove entry with no decidedOn",
      without(REMOVE, "decidedOn"),
      "u: a remove entry needs decidedOn",
    ],
    [
      "a remove entry with grounds",
      { ...REMOVE, grounds: "tool" },
      "u: a remove entry never carries grounds",
    ],
    [
      "a pending entry with utility",
      { ...PENDING, utility: "U." },
      "u: a pending entry never carries utility",
    ],
    [
      "a pending entry with a replacement",
      { ...PENDING, replacement: "R." },
      "u: a pending entry never carries replacement",
    ],
    [
      "a pending entry with decidedOn",
      { ...PENDING, decidedOn: "2026-10-25" },
      "u: a pending entry never carries decidedOn",
    ],
    [
      "a pending entry with grounds",
      { ...PENDING, grounds: "tool" },
      "u: a pending entry never carries grounds",
    ],
    [
      "a pending entry with a slice",
      { ...PENDING, slice: "2.B-1" },
      "u: a pending entry never carries slice",
    ],
    [
      "a decidedOn that is no date",
      { ...KEPT, decidedOn: "yesterday" },
      'u has decidedOn "yesterday", not a YYYY-MM-DD date',
    ],
    [
      "a decidedOn on no calendar day",
      { ...REMOVE, decidedOn: "2026-02-30" },
      'u has decidedOn "2026-02-30", not a YYYY-MM-DD date',
    ],
    ["a manual entry", { ...KEPT, manual: true }, "u: manual belongs to the legal inventory"],
  ])("returns a problem for %s", (_case, entry, expected) => {
    const baseline = entry["status"] === "pending" ? 1 : 0;

    const joined = core.joinDecisions(
      [rowOf("u", "production", ONE)],
      decisionsOf({ u: entry }, baseline)
    );

    expect(joined.problems).toEqual([expect.stringContaining(expected)]);
  });

  it("returns a problem for a floor that is not the real-site floor", () => {
    const joined = core.joinDecisions([rowOf("u", "production", ONE)], decisionsOf({}, 1, 2));

    expect(joined.problems).toEqual([
      "scripts/testing/dependency-decisions.json: floor 2 is not the real-site floor 3",
    ]);
  });

  it.each<[string, Readonly<Record<string, unknown>>, string]>([
    [
      "a kept entry above the floor",
      { above: KEPT },
      "above: a kept entry above the floor, which justifies it: delete the entry",
    ],
    [
      "a pending entry above the floor",
      { above: PENDING },
      "above: a pending entry above the floor, which justifies it: delete the entry",
    ],
    [
      "an entry that is no object above the floor",
      { above: null },
      "above: an entry with no status above the floor, which justifies it: delete the entry",
    ],
    [
      "an entry no manifest declares",
      { gone: REMOVE },
      "gone: no manifest declares it: delete the entry with its declaration",
    ],
  ])("returns %s as stale", (_case, entries, expected) => {
    const joined = core.joinDecisions([rowOf("above", "production", ABOVE)], decisionsOf(entries));

    expect(joined.problems).toEqual([expected]);
  });

  it.each<[string, number, string]>([
    ["above", 1, "2 pending exceed pendingBaseline 1: decide a, b or raise the baseline visibly"],
    ["below", 3, "stale pendingBaseline 3: lower it to 2"],
  ])("returns a problem when the pending count is %s its baseline", (_case, baseline, expected) => {
    const rows = [rowOf("b", "production", {}), rowOf("a", "production", ONE)];

    const joined = core.joinDecisions(rows, decisionsOf({}, baseline));

    expect(joined.pending).toBe(2);
    expect(joined.problems).toEqual([expected]);
  });

  it("returns pending, with no rule held, for an entry whose status the reader refused", () => {
    const decisions = decisionsOf({ u: { status: "decide", note: "N." } }, 1);

    const joined = core.joinDecisions([rowOf("u", "production", ONE)], decisions);

    expect(joined.problems).toEqual([]);
    expect(joined.rows.map((row) => row.decision)).toEqual(["pending"]);
  });

  it("returns pending for an entry that is no object under the floor", () => {
    const joined = core.joinDecisions([rowOf("u", "production", ONE)], decisionsOf({ u: null }, 1));

    expect(joined.problems).toEqual([]);
    expect(joined.rows.map((row) => row.decision)).toEqual(["pending"]);
  });

  it("returns the reader's own problems first, in their order", () => {
    const decisions = { ...decisionsOf({}, 0, 2), problems: ["first", "second"] };

    const joined = core.joinDecisions([rowOf("above", "production", ABOVE)], decisions);

    expect(joined.problems).toEqual([
      "first",
      "second",
      "scripts/testing/dependency-decisions.json: floor 2 is not the real-site floor 3",
    ]);
  });
});

describe("summarize", () => {
  /** `count` rows named `prefix0`, `prefix1`, …, all alike. */
  const rowsOf = (
    prefix: string,
    count: number,
    scope: Scope,
    sites: Sites,
    typedTarget: string | null = null
  ): Row[] =>
    Array.from({ length: count }, (_, index) =>
      rowOf(`${prefix}${String(index)}`, scope, sites, typedTarget)
    );
  const entriesOf = (rows: readonly Row[], entry: Fields): Record<string, Fields> =>
    Object.fromEntries(rows.map((row) => [row.name, entry]));

  it("returns every count from rows where no two counts are equal", () => {
    const removedAbove = rowsOf("pa", 7, "production", ABOVE);
    const plainAbove = rowsOf("pb", 2, "production", ABOVE);
    const removedAtZero = rowsOf("pz", 4, "production", {});
    const pendingAtZero = rowsOf("dz", 1, "dev-only", {});
    const keptWithSites = rowsOf("dk", 2, "dev-only", { binary: { config: ["package.json"] } });
    const types = rowsOf("@types/t", 3, "dev-only", { "type-only": { test: ["a.ts"] } }, "t");
    const pendingWithSites = rowsOf("dp", 2, "dev-only", { binary: { config: ["package.json"] } });
    const rows = [
      ...removedAbove,
      ...plainAbove,
      ...removedAtZero,
      ...pendingAtZero,
      ...keptWithSites,
      ...types,
      ...pendingWithSites,
    ];
    const decisions = decisionsOf(
      {
        ...entriesOf(removedAbove, REMOVE),
        ...entriesOf(removedAtZero, REMOVE),
        ...entriesOf(keptWithSites, KEPT),
      },
      6
    );

    const { ledger, problems } = core.buildLedger(rows, decisions);

    expect(problems).toEqual([]);
    expect(core.summarize(ledger.names)).toEqual({
      names: 21,
      production: 13,
      devOnly: 8,
      types: 3,
      aboveFloor: 9,
      underFloor: 12,
      atZero: 5,
      underFloorWithSites: 7,
      kept: 2,
      remove: 11,
      pending: 6,
    });
  });
});

describe("buildLedger and render", () => {
  const ROWS = [
    rowOf("above", "production", ABOVE),
    rowOf("siteless", "production", {}),
    rowOf("under", "dev-only", {
      "test-mock": { test: ["apps/api/tests/c.test.ts"] },
      "runtime-import": { test: ["apps/api/tests/b.test.ts", "apps/api/tests/a.test.ts"] },
    }),
  ];
  /** A second declaration, so the order of a row's declarations is something to sort. */
  const EXTRA_DECLARATION: RowDeclaration = {
    manifest: "apps/api/package.json",
    block: "a-block",
    specifier: "literal",
  };
  /** The rows in the opposite order, with the extra declaration, each list reversed. */
  const reversed = (rows: readonly Row[]): Row[] =>
    [...rows].reverse().map((row) => ({
      ...row,
      declarations: [...row.declarations, EXTRA_DECLARATION].reverse(),
      sites: Object.fromEntries(
        Object.entries(row.sites).map(([kind, byClass]) => [
          kind,
          Object.fromEntries(
            Object.entries(byClass).map(([pathClass, files]) => [
              pathClass,
              [...(files ?? [])].reverse(),
            ])
          ),
        ])
      ),
    }));

  it("returns real and sites for the names under the floor only, an empty object for a siteless one", () => {
    const { ledger, problems } = core.buildLedger(ROWS, decisionsOf({}, 2));

    expect(problems).toEqual([]);
    expect(Object.keys(ledger)).toEqual(["version", "floor", "summary", "names"]);
    expect([ledger.version, ledger.floor]).toEqual([1, 3]);
    expect(ledger.names.map((row) => Object.keys(row))).toEqual(
      ledger.names.map(() => [
        "name",
        "scope",
        "typedTarget",
        "declarations",
        "bins",
        "verdict",
        "real",
        "decision",
        "sites",
      ])
    );
    expect(ledger.names.map((row) => [row.name, row.verdict, row.real, row.decision])).toEqual([
      ["above", "above-floor", null, null],
      ["siteless", "under-floor", 0, "pending"],
      ["under", "under-floor", 2, "pending"],
    ]);
    expect(ledger.names.map((row) => row.sites)).toEqual([
      null,
      {},
      {
        "runtime-import": { test: ["apps/api/tests/a.test.ts", "apps/api/tests/b.test.ts"] },
        "test-mock": { test: ["apps/api/tests/c.test.ts"] },
      },
    ]);
    expect(Object.keys(ledger.names[2]?.sites ?? {})).toEqual(["runtime-import", "test-mock"]);
  });

  it("returns the names, each declaration list and each site list in code-unit order whatever order they come in", () => {
    const { ledger } = core.buildLedger(reversed(ROWS), decisionsOf({}, 2));

    expect(ledger.names.map((row) => row.name)).toEqual(["above", "siteless", "under"]);
    expect(ledger.names[2]?.declarations.map((declaration) => declaration.block)).toEqual([
      "a-block",
      "devDependencies",
    ]);
    expect(ledger.names[2]?.sites).toEqual({
      "runtime-import": { test: ["apps/api/tests/a.test.ts", "apps/api/tests/b.test.ts"] },
      "test-mock": { test: ["apps/api/tests/c.test.ts"] },
    });
  });

  it("renders byte-equal JSON from rows given in two orders, which parses back to the ledger", async () => {
    const twice = (rows: readonly Row[]): Row[] =>
      rows.map((row) => ({ ...row, declarations: [...row.declarations, EXTRA_DECLARATION] }));
    const forwardLedger = core.buildLedger(twice(ROWS), decisionsOf({}, 2)).ledger;

    const forward = await core.render(forwardLedger);
    const backward = await core.render(core.buildLedger(reversed(ROWS), decisionsOf({}, 2)).ledger);

    expect(backward).toBe(forward);
    expect(JSON.parse(forward)).toEqual(forwardLedger);
    expect(forward.endsWith("}\n")).toBe(true);
  });
});

/** The planted repository's files, the git listing the command reads through its seam. */
const LEDGER_TRACKED = [
  "package.json",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "apps/admin/package.json",
  "apps/web/package.json",
  "packages/kit/package.json",
  "packages/ui/package.json",
  "infra/db/package.json",
  "docs/legal/classification/subprocessors.json",
  "scripts/testing/dependency-decisions.json",
  "apps/web/src/a.ts",
  "apps/web/src/b.ts",
  "apps/web/src/c.ts",
];
const DECISIONS = "scripts/testing/dependency-decisions.json";
const GENERATOR_COMMAND = "scripts/testing/dependency-ledger.mjs";
const RECORD = "dependency-ledger.json";
const WEB_DEPENDENCIES = {
  "lib-a": "catalog:",
  "lib-b": "^1.0.0",
  "lib-d": "^1.0.0",
  "lib-f": "^1.0.0",
};
const ROOT_DEPENDENCIES = {
  "tool-a": "1.0.0",
  "tool-b": "1.0.0",
  "tool-c": "1.0.0",
  "tool-d": "1.0.0",
};
const REMOVED = {
  status: "remove",
  note: "N.",
  utility: "U.",
  replacement: "R.",
  decidedOn: "2026-10-24",
};
/** An entry its status refuses: a `kept` entry with a note and nothing else. */
const KEPT_WITHOUT_GROUNDS = { status: "kept", note: "N." };
/** What a renderer that refuses its configuration says, for the cases that plant one. */
const REFUSED = "the configuration could not be read";
/** One spawned command loads `typescript` and `prettier` before it reads anything: seconds. */
const SPAWN_TIMEOUT = 30_000;

/** The decisions file of the planted repository, with `entries` and the baseline given. */
const decisionsFile = (entries: Fields, pendingBaseline: number): Fields => ({
  generator: GENERATOR_COMMAND,
  floor: 3,
  pendingBaseline,
  entries,
});

/** The planted repository's decisions: the four names the owner removes. */
const PLANTED_ENTRIES = {
  "lib-d": REMOVED,
  "lib-f": REMOVED,
  "tool-c": REMOVED,
  "tool-d": REMOVED,
};

/**
 * Plants a repository whose counts differ wherever the command prints one: 6 manifests and 8
 * names. The four production names live in `apps/web`: `lib-a`, which three production files
 * import, is the one above the floor; `lib-b` and `lib-f` have one import each and `lib-d` none.
 * The four dev-only names live in the root: `tool-a` is run by a script and imported once,
 * `tool-b` is run by a script, `tool-c` has no site and `tool-d` is imported by a config file. So
 * the printed counts are 6 manifests, 8 names, 1 above the floor, 7 under it, 2 at zero and 3
 * pending, and the other summary counts are 4 production, 4 dev-only, 5 under the floor with a
 * site, 4 removed and 0 kept or typed: none of them equals a printed one.
 */
const plantRepository = (): void => {
  put("package.json", {
    name: "root",
    private: true,
    devDependencies: ROOT_DEPENDENCIES,
    scripts: { lint: "tool-a check", fmt: "tool-b" },
  });
  put(
    "pnpm-workspace.yaml",
    "packages:\n  - apps/*\n  - packages/*\n  - infra/*\n\ncatalog:\n  lib-a: 1.0.0\n"
  );
  put("apps/admin/package.json", { name: "@w/admin", private: true });
  put("apps/web/package.json", { name: "@w/web", dependencies: WEB_DEPENDENCIES });
  put("packages/kit/package.json", { name: "@w/kit", private: true });
  put("packages/ui/package.json", { name: "@w/ui", private: true });
  put("infra/db/package.json", { name: "@w/db" });
  put("docs/legal/classification/subprocessors.json", {
    pendingBaseline: 0,
    tooling: [],
    entries: {},
  });
  put(DECISIONS, decisionsFile(PLANTED_ENTRIES, 3));
  put("node_modules/tool-a/package.json", { name: "tool-a", bin: { "tool-a": "cli.js" } });
  put("node_modules/tool-b/package.json", { name: "tool-b", bin: { "tool-b": "cli.js" } });
  put("node_modules/tool-c/package.json", { name: "tool-c" });
  put("node_modules/tool-d/package.json", { name: "tool-d" });
  Object.keys(WEB_DEPENDENCIES).forEach((name) =>
    put(`apps/web/node_modules/${name}/package.json`, { name })
  );
  put("vite.config.ts", 'import { d } from "tool-d";\nexport default d;\n');
  put("apps/web/src/a.ts", 'import { a } from "lib-a";\nimport { b } from "lib-b";\n');
  put("apps/web/src/b.ts", 'import { a } from "lib-a";\nimport { f } from "lib-f";\n');
  put("apps/web/src/c.ts", 'import { a } from "lib-a";\nimport { t } from "tool-a";\n');
};

const listing = (files: readonly string[] = LEDGER_TRACKED): CommandSeams => ({
  listFiles: () => ({ value: [...files] }),
});

const run = (args: readonly string[], seams: CommandSeams = listing()): Promise<CliResult> =>
  cli.main(["--root", root, ...args], seams);

const record = (): string => readFileSync(path.join(root, RECORD), "utf8");

/** The environment a spawned command runs in: no `GIT_*` setting, and no repository above root. */
const spawnEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CEILING_DIRECTORIES: path.dirname(root),
});

describe("dependency-ledger.mjs write mode and --sites", () => {
  beforeEach(() => {
    plantRepository();
  });

  it("returns 0, writes the record and prints its counts", async () => {
    const result = await run([]);

    expect(result).toEqual({
      code: 0,
      output:
        "dependency-ledger: wrote dependency-ledger.json: 6 manifests, 8 names, 1 at or above the floor, 7 under it (2 at zero); pending 3 of baseline 3\n",
    });
    const written = JSON.parse(record()) as Ledger;
    expect(written.names.map((row) => [row.name, row.verdict, row.real, row.decision])).toEqual([
      ["lib-a", "above-floor", null, null],
      ["lib-b", "under-floor", 1, "pending"],
      ["lib-d", "under-floor", 0, "remove"],
      ["lib-f", "under-floor", 1, "remove"],
      ["tool-a", "under-floor", 2, "pending"],
      ["tool-b", "under-floor", 1, "pending"],
      ["tool-c", "under-floor", 0, "remove"],
      ["tool-d", "under-floor", 1, "remove"],
    ]);
    expect(written.names[4]?.sites).toEqual({
      "runtime-import": { production: ["apps/web/src/c.ts"] },
      binary: { config: ["package.json"] },
    });
  });

  it("returns 1 and still writes the record when a decision is off its contract", async () => {
    put(DECISIONS, decisionsFile({ ...PLANTED_ENTRIES, "lib-b": KEPT_WITHOUT_GROUNDS }, 3));

    const result = await run([]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("dependency-ledger: lib-b: a kept entry needs grounds\n");
    expect(result.output).toContain("dependency-ledger: stale pendingBaseline 3: lower it to 2\n");
    expect(result.output).toContain("; pending 2 of baseline 3\n");
    expect(JSON.parse(record())).toMatchObject({ summary: { kept: 1, remove: 4, pending: 2 } });
  });

  it("returns 0 and prints a name's sites in code-unit order, the binary one first", async () => {
    const result = await run(["--sites", "tool-a"]);

    expect(result).toEqual({
      code: 0,
      output: "binary\tconfig\tpackage.json\nruntime-import\tproduction\tapps/web/src/c.ts\n",
    });
  });

  it("returns 0 and prints a name's files in code-unit order whatever order git lists them in", async () => {
    const result = await run(["--sites", "lib-a"], listing([...LEDGER_TRACKED].reverse()));

    expect(result).toEqual({
      code: 0,
      output: [
        "runtime-import\tproduction\tapps/web/src/a.ts",
        "runtime-import\tproduction\tapps/web/src/b.ts",
        "runtime-import\tproduction\tapps/web/src/c.ts",
        "",
      ].join("\n"),
    });
  });

  it("returns 0 and prints nothing for a declared name with no site", async () => {
    expect(await run(["--sites", "lib-d"])).toEqual({ code: 0, output: "" });
  });
});

describe("dependency-ledger.mjs over its own files", () => {
  beforeEach(() => {
    plantRepository();
  });

  it("returns no site for a name one of the ledger's files writes as a string, and a runtime site for the one it imports", async () => {
    const ledgerModule = "scripts/testing/lib/dependency-manifests.mjs";
    const ledgerSuite = "apps/api/tests/unit/scripts/dependencyLedger.test.ts";
    put(ledgerModule, 'import { t } from "tool-a";\nexport const NAMED = "tool-a";\n');
    put(ledgerSuite, 'export const PLANTED = "tool-a";\n');
    put("scripts/other.mjs", 'export const NAMED = "tool-a";\n');

    const result = await run(
      ["--sites", "tool-a"],
      listing([...LEDGER_TRACKED, ledgerModule, ledgerSuite, "scripts/other.mjs"])
    );

    expect(result).toEqual({
      code: 0,
      output: [
        "binary\tconfig\tpackage.json",
        "config-string\tconfig\tscripts/other.mjs",
        "runtime-import\tconfig\tscripts/testing/lib/dependency-manifests.mjs",
        "runtime-import\tproduction\tapps/web/src/c.ts",
        "",
      ].join("\n"),
    });
  });

  it("returns every file it names as its own present in this repository", () => {
    expect(cli.LEDGER_FILES.filter((file) => !existsSync(path.join(REPO_ROOT, file)))).toEqual([]);
  });
});

describe("dependency-ledger.mjs unread inputs", () => {
  beforeEach(() => {
    plantRepository();
  });

  it.each<[string, () => CommandSeams, string]>([
    [
      "a failing git listing",
      () => ({ listFiles: () => ({ error: "git ls-files failed" }) }),
      "git ls-files failed",
    ],
    ["an empty git listing", () => listing([]), "git ls-files listed nothing"],
    [
      "a listing with no JavaScript or TypeScript file",
      () => listing(LEDGER_TRACKED.filter((file) => !file.endsWith(".ts"))),
      "zero JavaScript or TypeScript files among the tracked files",
    ],
    [
      "a tracked module that cannot be read",
      () => listing([...LEDGER_TRACKED, "apps/web/src/gone.ts"]),
      "apps/web/src/gone.ts could not be read",
    ],
    [
      "a tracked stylesheet that cannot be read",
      () => listing([...LEDGER_TRACKED, "apps/web/src/gone.css"]),
      "apps/web/src/gone.css could not be read",
    ],
    [
      "a tracked hook that cannot be read",
      () => listing([...LEDGER_TRACKED, ".husky/pre-commit"]),
      ".husky/pre-commit could not be read",
    ],
    [
      "a workspace root that is a file, which the legal scan throws on",
      () => {
        rmSync(path.join(root, "infra"), { recursive: true });
        put("infra", "not a directory\n");
        return listing(LEDGER_TRACKED.filter((file) => !file.startsWith("infra/")));
      },
      "the legal scan could not walk the workspace roots: ENOTDIR",
    ],
  ])("returns 3 for %s", async (_case, seams, expected) => {
    const result = await run([], seams());

    expect(result.code).toBe(3);
    expect(result.output).toContain(`dependency-ledger: unread: ${expected}`);
  });

  it.each<[string, () => void, string]>([
    [
      "a workspace manifest that cannot be read",
      () => rmSync(path.join(root, "pnpm-workspace.yaml")),
      "pnpm-workspace.yaml could not be read",
    ],
    [
      "a catalog reference the catalogs do not hold",
      () =>
        put("apps/web/package.json", {
          name: "@w/web",
          dependencies: { ...WEB_DEPENDENCIES, "lib-a": "catalog:nope" },
        }),
      "catalog:nope names a catalog pnpm-workspace.yaml does not hold",
    ],
    [
      "a manifest outside the workspace globs",
      () => put("apps/web/tools/package.json", { name: "@w/tools" }),
      "the workspace manifests and the legal scan disagree: only the legal scan reads apps/web/tools/package.json",
    ],
    [
      "an installed copy that cannot be read",
      () => rmSync(path.join(root, "node_modules/tool-a"), { recursive: true }),
      "package.json declares tool-a, and its installed copy cannot be read",
    ],
    [
      "a legal classification with no tooling array",
      () =>
        put("docs/legal/classification/subprocessors.json", { pendingBaseline: 0, entries: {} }),
      "docs/legal/classification/subprocessors.json holds no tooling array",
    ],
    [
      "a legal classification that is no JSON",
      () => put("docs/legal/classification/subprocessors.json", "{"),
      "docs/legal/classification/subprocessors.json is not JSON",
    ],
    [
      "a missing workspace root",
      () => rmSync(path.join(root, "infra"), { recursive: true }),
      "infra does not exist",
    ],
    [
      "a decisions file that is missing",
      () => rmSync(path.join(root, DECISIONS)),
      `${DECISIONS} is missing or empty`,
    ],
    ["a decisions file that is no JSON", () => put(DECISIONS, "{"), `${DECISIONS} is not JSON`],
    [
      "a catalog line it cannot read",
      () =>
        put(
          "pnpm-workspace.yaml",
          "packages:\n  - apps/*\n  - packages/*\n  - infra/*\n\ncatalog:\n  lib-a 1.0.0\n"
        ),
      'pnpm-workspace.yaml: cannot read "lib-a 1.0.0"',
    ],
    [
      "a workspace manifest with no packages: block",
      () => put("pnpm-workspace.yaml", "catalog:\n  lib-a: 1.0.0\n"),
      "pnpm-workspace.yaml has no packages: block",
    ],
    [
      "a legal classification that cannot be read",
      () => rmSync(path.join(root, "docs/legal/classification/subprocessors.json")),
      "docs/legal/classification/subprocessors.json could not be read",
    ],
    [
      "a tooling entry the legal reader refuses",
      () =>
        put("docs/legal/classification/subprocessors.json", {
          pendingBaseline: 0,
          tooling: [{ workspace: "@w/web", extra: true, note: "N." }],
          entries: {},
        }),
      "docs/legal/classification/subprocessors.json: tooling @w/web has unknown keys extra",
    ],
    [
      "a tooling workspace the legal scan refuses",
      () =>
        put("docs/legal/classification/subprocessors.json", {
          pendingBaseline: 0,
          tooling: [{ workspace: "@w/none", note: "N." }],
          entries: {},
        }),
      "docs/legal/classification/subprocessors.json: tooling @w/none is not a workspace package",
    ],
    [
      "a manifest that is no JSON object",
      () => put("infra/db/package.json", "{"),
      "infra/db/package.json is not a JSON object",
    ],
    [
      "no workspace manifest beyond the root",
      () =>
        ["apps/admin", "apps/web", "packages/kit", "packages/ui", "infra/db"].forEach((dir) =>
          rmSync(path.join(root, dir, "package.json"))
        ),
      "the legal scan read zero manifests beyond the root",
    ],
    [
      "manifests that declare no dependency",
      () => {
        put("package.json", { name: "root", private: true });
        put("apps/web/package.json", { name: "@w/web" });
      },
      "the manifests declare zero dependency names",
    ],
  ])("returns 3 for %s", async (_case, plant, expected) => {
    plant();

    const result = await run([]);

    expect(result.code).toBe(3);
    expect(result.output).toContain(`dependency-ledger: unread: ${expected}`);
  });

  it("returns 3 when the record cannot be rendered", async () => {
    const result = await run([], {
      ...listing(),
      render: () => Promise.reject(new Error(REFUSED)),
    });

    expect(result.code).toBe(3);
    expect(result.output).toContain(
      `dependency-ledger: unread: the record could not be rendered: ${REFUSED}`
    );
  });

  it("returns 3 over 1 when the record cannot be written and a decision is off its contract", async () => {
    put(DECISIONS, decisionsFile({ ...PLANTED_ENTRIES, "lib-b": KEPT_WITHOUT_GROUNDS }, 2));
    const out = path.join(root, "missing-directory", "record.json");

    const result = await run(["--out", out]);

    expect(result.code).toBe(3);
    expect(result.output).toContain("dependency-ledger: lib-b: a kept entry needs grounds\n");
    expect(result.output).toContain(
      "dependency-ledger: missing-directory/record.json could not be written"
    );
  });

  it(
    "exits 3 with the reason on stderr when run as a script over a directory git does not track",
    { timeout: SPAWN_TIMEOUT },
    () => {
      const spawned = spawnSync(process.execPath, [COMMAND, "--root", root], {
        encoding: "utf8",
        env: spawnEnvironment(),
        timeout: SPAWN_TIMEOUT,
      });

      expect(spawned.status).toBe(3);
      expect(spawned.stdout).toBe("");
      expect(spawned.stderr).toContain(`dependency-ledger: unread: git ls-files failed in ${root}`);
    }
  );

  it(
    "exits 3 naming a module the parser cannot read, run under V8's default stack size",
    { timeout: SPAWN_TIMEOUT },
    () => {
      put(
        "apps/web/src/deep.ts",
        `export const deep = ${"[".repeat(20_000)}${"]".repeat(20_000)};\n`
      );
      const env = spawnEnvironment();
      execFileSync("git", ["init", "--quiet"], { cwd: root, env });
      execFileSync("git", ["add", "--all"], { cwd: root, env });

      const spawned = spawnSync(process.execPath, [COMMAND, "--root", root], {
        encoding: "utf8",
        env,
        timeout: SPAWN_TIMEOUT,
      });

      expect(spawned.status).toBe(3);
      expect(spawned.stderr).toContain(
        "dependency-ledger: unread: apps/web/src/deep.ts could not be parsed"
      );
    }
  );
});

describe("dependency-ledger.mjs usage", () => {
  beforeEach(() => {
    plantRepository();
  });

  it.each<[string, readonly string[], string]>([
    ["a positional argument", ["extra"], "Unexpected argument 'extra'"],
    ["an unknown flag", ["--write"], "Unknown option '--write'"],
    ["an empty --root", ["--root", ""], "--root takes a non-empty value"],
    ["an empty --out", ["--out", ""], "--out takes a non-empty value"],
    ["an empty --sites", ["--sites", ""], "--sites takes a non-empty value"],
    [
      "--sites of a name no manifest declares",
      ["--sites", "nope"],
      "--sites nope: no manifest declares nope",
    ],
  ])("returns 2 for %s", async (_case, args, expected) => {
    const result = await run(args);

    expect(result.code).toBe(2);
    expect(result.output).toContain(`dependency-ledger: ${expected}`);
  });
});
