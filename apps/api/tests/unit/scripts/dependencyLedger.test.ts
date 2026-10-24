/**
 * @file dependencyLedger.test.ts
 * @description Pins the manifest side of the dependency-usage ledger,
 *   `scripts/testing/lib/dependency-manifests.mjs`: the workspace manifests the `packages:` globs
 *   reach and their agreement with the legal scan of `scripts/legal/subprocessors.mjs`, and the
 *   catalogs of `pnpm-workspace.yaml` and the specifier kind of a declaration. Each case runs over
 *   a tree planted in a fresh directory under `tmpdir()`, with the tracked files handed in as a
 *   list, so nothing is spawned and the repository is read for its workspace manifest only.
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

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type ManifestsModule = {
  workspaceManifests: (root: string, tracked: readonly string[]) => Result<string[]>;
  manifestDisagreement: (derived: readonly string[], legal: readonly string[]) => string | null;
  readCatalogs: (text: string) => Result<Catalogs>;
  specifierKindOf: (spec: string, catalogs: Catalogs, name: string) => Result<string>;
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
