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

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const MANIFESTS_LIB = path.join(REPO_ROOT, "scripts/testing/lib/dependency-manifests.mjs");
const LEGAL = path.join(REPO_ROOT, "scripts/legal/subprocessors.mjs");
const manifests = (await import(MANIFESTS_LIB)) as ManifestsModule;
const { scanManifests } = (await import(LEGAL)) as LegalModule;

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
