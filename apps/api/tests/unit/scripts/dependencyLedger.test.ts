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
 *   literal inputs: the rows the readers' outputs join into, the real-site rule and the floor, and
 *   the owner's decisions and every rule they are held to. Only the decisions file is planted on
 *   disk, for the one reader of it.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  workspaceManifests: (root: string, tracked: readonly string[]) => Result<string[]>;
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
  scanManifests: (root: string, listed?: string[]) => { manifests: string[] };
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

/** The core's surface, typed for the same reason as the manifests module's. */
type CoreModule = {
  realSitesOf: (row: Counted) => number;
  verdictOf: (real: number) => Verdict;
  buildRows: (input: RowsInput) => Result<Row[]>;
  loadDecisions: (root: string) => Result<Decisions>;
  joinDecisions: (rows: readonly Row[], decisions: Decisions) => Joined;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const MANIFESTS_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-manifests.mjs");
const LEGAL = path.join(REPO_ROOT, "scripts/legal/subprocessors.mjs");
const CORE_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-ledger-core.mjs");
const manifests = (await import(MANIFESTS_LIB)) as ManifestsModule;
const { scanManifests } = (await import(LEGAL)) as LegalModule;
const core = (await import(CORE_LIB)) as CoreModule;

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

    const derived = valueOf(manifests.workspaceManifests(root, tracked));

    expect(derived).toEqual(PLANTED_MANIFESTS);
    expect(manifests.manifestDisagreement(derived, scanManifests(root).manifests)).toBeNull();
  });

  it("returns the manifests each side holds alone when the globs and the legal scan disagree", () => {
    const deep = "apps/api/fixtures/package.json";
    const outside = "tools/x/package.json";
    plantWorkspace(`${WORKSPACE_TEXT}\n`.replace("  - infra/*\n", "  - infra/*\n  - tools/*\n"), [
      ...PLANTED_MANIFESTS,
      deep,
      outside,
    ]);
    const derived = valueOf(
      manifests.workspaceManifests(root, [...PLANTED_MANIFESTS, deep, outside])
    );

    const disagreement = manifests.manifestDisagreement(derived, scanManifests(root).manifests);

    expect(derived).toContain(outside);
    expect(derived).not.toContain(deep);
    expect(disagreement).toContain(`only the workspace globs reach ${outside}`);
    expect(disagreement).toContain(`only the legal scan reads ${deep}`);
  });

  it("returns no manifest a negated glob names", () => {
    const files = ["package.json", "packages/a/package.json", "packages/skip/package.json"];
    plantWorkspace('packages:\n  - packages/*\n  - "!packages/skip"\n', files);

    const derived = valueOf(manifests.workspaceManifests(root, files));

    expect(derived).toEqual(["package.json", "packages/a/package.json"]);
  });

  it.each<[string, string | null, string]>([
    ["no workspace manifest", null, `${WORKSPACE} could not be read`],
    ["no packages: block", "catalog:\n  react: 19.2.7\n", `${WORKSPACE} has no packages: block`],
    ["a glob line it cannot read", "packages:\n  apps/*\n", 'cannot read "apps/*"'],
  ])("returns an error for %s", (_case, text, expected) => {
    if (text !== null) put(WORKSPACE, text);

    const result = manifests.workspaceManifests(root, ["package.json"]);

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
