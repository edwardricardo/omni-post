/**
 * @file subprocessorsInventory.test.ts
 * @description Pins `scripts/legal/subprocessors.mjs`: the manifest scan and its production or
 *   dev-only derivation, the `tooling` list and its refusals, the derived recipients without a
 *   dependency, the scan hash, the classification refusals and scope errors, and the committed page
 *   equal byte for byte to the one regenerated from the real tree. Each case runs on a scratch tree
 *   that starts green.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Inventory = { pagePath: string; markdown: string; problems: string[]; scopeError?: string };
type Entry = Record<string, unknown>;
type Row = [string, () => void, string];
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Scan = {
  names: Map<string, { manifests: string[]; production: boolean }>;
  listed: string[];
  problems: string[];
};
type Generator = Record<"CLASSIFICATION" | "PAGE", string> & {
  scanManifests: (root: string, listed?: string[]) => Scan;
  buildInventory: (options: { root: string }) => Promise<Inventory>;
  generator: { generate: (options?: { root: string }) => Promise<Inventory> };
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GENERATOR = path.join(REPO_ROOT, "scripts/legal/subprocessors.mjs");
const { CLASSIFICATION, PAGE, ...api } = (await import(GENERATOR)) as Generator;
const { scanManifests, buildInventory, generator } = api;

const SCHEMA = "infra/prisma/schema.prisma";
const API = "apps/api/package.json";
const DB = "infra/db/package.json";
const WS = "workspace:*";
const LIBRARY = { status: "library", note: "N." };
const SERVICE = { status: "service", vendor: "V.", purpose: "P.", envToggle: "E.", dataSent: "D." };
/** The root and `@w/t`, declared only as a devDependency, are tooling; the last three are pruned. */
const MANIFESTS: Record<string, Entry> = {
  "package.json": { dependencies: { env: "1" }, devDependencies: { lint: "1", "@w/t": WS } },
  [API]: { name: "@w/api", dependencies: { pay: "catalog:", "@w/core": "1", alias: WS } },
  "packages/core/package.json": { name: "@w/core", peerDependencies: { peer: "1" } },
  "packages/testing/package.json": { name: "@w/t", dependencies: { mock: "1" } },
  "packages/providers/x/package.json": { name: "@w/x", dependencies: { xsdk: "1" } },
  [DB]: { name: "@w/db", optionalDependencies: { pay: "1" }, devDependencies: { lint: "1" } },
  "apps/api/node_modules/hidden/package.json": { dependencies: { hidden: "1" } },
  "packages/core/dist/package.json": { dependencies: { built: "1" } },
  "apps/admin/.next/package.json": { dependencies: { next: "1" } },
};
const KEPT = Object.keys(MANIFESTS).slice(0, 6);

let root = "";
let entries: Record<string, Entry> = {};
let pendingBaseline = 0;
/** The classification's `tooling` list; `undefined` leaves the key out of the file. */
let tooling: unknown = [];

const put = (file: string, data: unknown): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), typeof data === "string" ? data : JSON.stringify(data));
};
const remove = (file: string): void => rmSync(path.join(root, file), { recursive: true });
const build = (): Promise<Inventory> => {
  put(CLASSIFICATION, { pendingBaseline, tooling, entries });
  return buildInventory({ root });
};
const set = (name: string, overrides: Entry) => (): void => {
  entries[name] = { ...entries[name], ...overrides };
};
const hashOf = (markdown: string): string | undefined =>
  /package\.json` \(sha256 `(\w+)`/.exec(markdown)?.[1];
const section = (markdown: string, heading: string): string =>
  markdown.split(`## ${heading}\n`)[1]?.split("\n## ")[0]?.trim() ?? "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "subprocessors-inventory-test-"));
  Object.entries(MANIFESTS).forEach(([file, data]) => put(file, data));
  put(SCHEMA, "enum Provider {\n  X\n  INSTAGRAM // reached by fetch\n}\n");
  pendingBaseline = 0;
  tooling = [];
  const service = { ...SERVICE, productionPath: "yes", note: "N." };
  entries = { pay: service, xsdk: service, "fetch:mail": { ...service, manual: true } };
  ["env", "lint", "mock", "peer"].forEach((name) => (entries[name] = LIBRARY));
});

afterEach(() => {
  // Restored here, not in the test body, so a throwing generate() cannot leak the stdout stub.
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("the scan", () => {
  it("unions the names without workspaces or build output, and derives production", () => {
    const { names } = scanManifests(root);
    const devOnly = [...names].filter(([, d]) => !d.production).map(([name]) => name);

    expect([...names.keys()]).toEqual(["env", "lint", "mock", "pay", "peer", "xsdk"]);
    expect(names.get("pay")?.manifests).toEqual([API, DB]);
    expect(devOnly).toEqual(["env", "lint", "mock"]);
    put(API, { name: "@w/api", dependencies: { "@w/t": WS } });
    expect(scanManifests(root).names.get("mock")?.production).toBe(true);
  });

  it("renders the services and the providers no service reaches, byte-stable", async () => {
    const [first, second] = [await build(), await build()];
    const services = section(first.markdown, "Subprocessors");
    const without = (md: string): string => section(md, "Recipients without a dependency");

    expect(first.problems).toEqual([]);
    expect(services).toMatch(/\| `pay` .*\| apps\/api\/\S+, infra\/db\/package\.json +\|/);
    expect(services).toMatch(/\| `fetch:mail` \(manual\) +\|.*\| none: reached by `fetch` +\|/);
    expect(without(first.markdown)).toMatch(/\n- `instagram`$/);
    expect(second.markdown).toBe(first.markdown);
    entries["xsdk"] = LIBRARY;
    expect(without((await build()).markdown)).toMatch(/\n- `x`\n- `instagram`$/);
  });

  it("keeps the page on an edit that adds no name, and moves the scan hash on a planted name", async () => {
    const before = (await build()).markdown;
    put(DB, { ...MANIFESTS[DB], optionalDependencies: { pay: "2" }, scripts: { build: "tsc" } });
    put("packages/extra/package.json", { name: "@w/extra" });

    expect((await build()).markdown).toBe(before);
    put("packages/extra/package.json", { name: "@w/extra", dependencies: { planted: "1" } });
    expect(hashOf((await build()).markdown)).not.toBe(hashOf(before));
  });

  it("counts a manual service as without a dependency, never as dev-only", async () => {
    entries["lint"] = { ...entries["pay"] };
    const summary = section((await build()).markdown, "Summary");

    expect(summary).toMatch(/\| dev-only services +\| 1 +\|/);
    expect(summary).toMatch(/\| services without a dependency \(manual\) +\| 1 +\|/);
  });
});

describe("the tooling list", () => {
  const RUNNER = "packages/runner/package.json";
  const TESTING = "packages/testing/package.json";
  const LISTED = { workspace: "@w/r", note: "Private, run only in CI." };
  /** A private workspace no manifest declares; its run needs `runner` and the tooling `@w/t`. */
  const runner = { name: "@w/r", private: true, dependencies: { runner: "1", "@w/t": WS } };
  /** The Scope cell of a service's row in the Inventory table. */
  const scopeOf = (markdown: string, name: string): string | undefined =>
    new RegExp("\\| `" + name + "` +\\| service +\\| ([a-z-]+) +\\|").exec(markdown)?.[1];

  beforeEach(() => {
    put(RUNNER, runner);
    entries["runner"] = { ...SERVICE, productionPath: "no", note: "N." };
  });

  it("keeps a listed workspace's dependencies, and the workspaces it declares, out of production", () => {
    const listed = scanManifests(root, ["@w/r"]);
    const unlisted = scanManifests(root);

    expect(listed.problems).toEqual([]);
    expect(listed.listed).toEqual(["@w/r"]);
    expect(listed.names.get("runner")?.production).toBe(false);
    expect(listed.names.get("mock")?.production).toBe(false);
    expect(unlisted.names.get("runner")?.production).toBe(true);
    expect(unlisted.names.get("mock")?.production).toBe(true);
    put(TESTING, { ...MANIFESTS[TESTING], dependencies: { mock: "1", "@w/r": WS } });
    expect(scanManifests(root, ["@w/r"]).problems).toEqual([]);
  });

  it("counts a workspace only tooling declares as tooling, until a manifest that is not declares it", () => {
    put(RUNNER, { ...runner, dependencies: { ...runner.dependencies, "@w/h": WS } });
    put("packages/helper/package.json", { name: "@w/h", dependencies: { helper: "1" } });

    expect(scanManifests(root, ["@w/r"]).names.get("helper")?.production).toBe(false);
    put(API, { name: "@w/api", dependencies: { pay: "catalog:", "@w/h": WS } });
    expect(scanManifests(root, ["@w/r"]).names.get("helper")?.production).toBe(true);
  });

  it("renders the list it applied, and a listed workspace's service as dev-only", async () => {
    tooling = [LISTED];
    const listed = await build();
    tooling = [];
    const unlisted = await build();

    expect(listed.problems).toEqual([]);
    expect(scopeOf(listed.markdown, "runner")).toBe("dev-only");
    expect(section(listed.markdown, "About this page")).toContain("names (`@w/r`)");
    expect(unlisted.problems).toEqual([]);
    expect(scopeOf(unlisted.markdown, "runner")).toBe("production");
    expect(section(unlisted.markdown, "About this page")).toContain("names (none)");
  });

  it.each<Row>([
    ["no tooling array", () => (tooling = undefined), `${CLASSIFICATION} holds no tooling array`],
    ["an entry that is no object", () => (tooling = ["@w/r"]), "tooling entry 0 is not an object"],
    [
      "an unknown key",
      () => (tooling = [{ ...LISTED, x: "1" }]),
      "tooling @w/r has unknown keys x",
    ],
    ["an entry with no workspace", () => (tooling = [{ note: "N." }]), "entry 0 has no workspace"],
    [
      "an entry with no note",
      () => (tooling = [{ workspace: "@w/r" }]),
      "tooling @w/r has no note",
    ],
    [
      "a name no workspace carries",
      () => (tooling = [{ ...LISTED, workspace: "@w/none" }]),
      "tooling @w/none is not a workspace package",
    ],
    [
      "a workspace that is not private",
      () => put(RUNNER, { ...runner, private: false }),
      "tooling @w/r is not private: true",
    ],
    [
      "a workspace a manifest that is not tooling declares outside devDependencies",
      () => put(DB, { ...MANIFESTS[DB], dependencies: { "@w/r": WS } }),
      `outside devDependencies by a manifest that is not tooling: ${DB} (dependencies)`,
    ],
  ])("refuses %s, and does not apply it", async (_case, plant, expected) => {
    tooling = [LISTED];
    plant();
    const { problems, markdown } = await build();

    expect(problems.join("\n")).toContain(expected);
    expect(scopeOf(markdown, "runner")).toBe("production");
  });

  it("refuses a duplicate, and applies the name once", async () => {
    tooling = [LISTED, LISTED];
    const { problems, markdown } = await build();

    expect(problems).toEqual([`${CLASSIFICATION}: tooling @w/r is listed twice`]);
    expect(scopeOf(markdown, "runner")).toBe("dev-only");
  });
});

describe("the classification", () => {
  const noField = (f: string): Row => [`no ${f}`, set("pay", { [f]: undefined }), `with no ${f}`];

  it.each<Row>([
    ["a new candidate", () => put(DB, { dependencies: { fresh: "1" } }), "fresh is a candidate"],
    ["a stale entry", () => (entries["gone"] = LIBRARY), "gone is classified but no manifest"],
    ["an invalid status", set("pay", { status: "personal" }), 'pay has status "personal"'],
    ...["vendor", "purpose", "envToggle", "dataSent", "productionPath"].map(noField),
    ["an unknown production path", set("pay", { productionPath: "?" }), 'productionPath "?", not'],
    ["a service field on a library", set("env", { vendor: "V." }), "env: vendor belongs on a"],
    ["a declared manual entry", set("pay", { manual: true }), "pay: manual, but a manifest"],
    ["a manual library", set("fetch:mail", LIBRARY), "fetch:mail: manual, but not a service"],
    ["pending above baseline", set("lint", { status: "pending" }), "1 pending exceed"],
    ["pending below baseline", () => (pendingBaseline = 1), "stale pendingBaseline 1"],
  ])("refuses %s", async (_case, plant, expected) => {
    plant();
    const { problems, scopeError } = await build();

    expect([...problems, scopeError ?? ""].join("\n")).toContain(expected);
  });

  it.each<Row>([
    ["zero manifests", () => KEPT.slice(1).forEach(remove), "infra yielded zero manifests"],
    ["zero names", () => KEPT.forEach((file) => put(file, {})), "zero dependency names"],
    ["a missing root", () => remove("infra"), "infra does not exist"],
    ["a manifest that is no JSON", () => put(API, "{"), `${API} is not a JSON object`],
    ["a missing schema", () => remove(SCHEMA), `${SCHEMA} does not exist`],
    ["zero enum providers", () => put(SCHEMA, "enum Kind {\n  A\n}\n"), "zero Provider enum"],
  ])("fails closed on %s", async (_case, plant, expected) => {
    plant();

    expect((await build()).scopeError).toContain(expected);
  });
});

describe("the generator's stdout", () => {
  it("prints nothing when the scan fails closed", async () => {
    const printed: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => printed.push(`${chunk}`) > 0);
    remove("infra");

    const { scopeError } = await generator.generate({ root });

    expect(scopeError).toContain("infra does not exist");
    expect(printed).toEqual([]);
  });
});

describe("the real tree", () => {
  it("reports no problem, lists the payment and error-tracking SDKs, equals the page", async () => {
    const { problems, markdown } = await buildInventory({ root: REPO_ROOT });
    const services = section(markdown, "Subprocessors");

    expect(problems).toEqual([]);
    for (const name of ["stripe", "@paddle/paddle-node-sdk", "@sentry/node", "@sentry/nextjs"])
      expect(services).toContain(`| \`${name}\` `);
    expect(markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
