/**
 * @file personalDataInventory.test.ts
 * @description Pins `scripts/legal/personal-data.mjs`, the first legal inventory: the schema
 *   parser, candidates by name segment, the refusals that join candidates with the classification,
 *   and, over the real tree, a committed page equal byte for byte to the regenerated one. Each
 *   refusal is proven on a scratch fixture tree that starts green; the validation, rendering and
 *   runner rules of `scripts/legal/lib/inventory.mjs` are pinned by `legalInventoryLib.test.ts`.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Field = { field: string; attributes: string[] };
type Models = Array<{ name: string; fields: Field[] }>;
type Inventory = { pagePath: string; markdown: string; problems: string[]; scopeError?: string };
type Entry = Record<string, unknown>;
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Generator = {
  SCHEMA: string;
  CLASSIFICATION: string;
  PAGE: string;
  parsePrismaSchema: (text: string) => Models;
  findCandidates: (models: Models) => Field[];
  buildInventory: (options: { root: string }) => Promise<Inventory>;
  generator: { generate: (options?: { root: string }) => Promise<Inventory> };
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GENERATOR = path.join(REPO_ROOT, "scripts/legal/personal-data.mjs");
const { SCHEMA, CLASSIFICATION, PAGE, parsePrismaSchema, findCandidates, ...api } = (await import(
  GENERATOR
)) as Generator;
const { buildInventory, generator } = api;

const EMAIL = { status: "personal", category: "contact", subject: "third-party", note: "Address." };

let root = "";
let schema = "";
let entries: Record<string, Entry> = {};
let pendingBaseline = 0;

const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const build = (): Promise<Inventory> => {
  put(SCHEMA, schema);
  put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
  return buildInventory({ root });
};
const setEmail = (overrides: Entry) => (): void => {
  entries["Visitor.email"] = { ...EMAIL, ...overrides };
};
const provenance = (markdown: string): string =>
  markdown.split("\n").find((line) => line.startsWith("> Generated")) ?? "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "personal-data-inventory-test-"));
  schema = "model Visitor {\n  id String @id\n  email String\n  nickname String?\n}\n";
  [entries, pendingBaseline] = [{ "Visitor.email": EMAIL }, 0];
});

afterEach(() => {
  // Restored here, not in the test body, so a throwing generate() cannot leak the stdout stub.
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("candidates", () => {
  it("match a vocabulary token as a whole name segment, never as a substring", () => {
    const misses = ["description", "membership", "ownership", "recipient", "relationship"];
    const hits = ["clientIp", "ipAddress", "displayName", "userAgent", "firstName", "username"];
    const lines = [...misses, ...hits].map((name) => `  ${name} String`).join("\n");

    const found = findCandidates(parsePrismaSchema(`model Probe {\n${lines}\n}\n`));

    expect(found.map((field) => field.field)).toEqual(hits);
  });

  it("carry optional, list, attributes and the doc above them; @@ lines are no field", () => {
    const fields = [
      '/// Public.\n  /// Unique.\n  handle String? @unique @default("a//b") // x',
      "tags String[]",
    ];
    const text = `enum Kind {\n  A\n}\nmodel Probe {\n  ${fields.join("\n  ")}\n  @@index([handle])\n}\n`;

    const [handle, tags, extra] = parsePrismaSchema(text)[0]?.fields ?? [];

    expect(handle).toMatchObject({ optional: true, isList: false, doc: "Public. Unique." });
    expect(handle?.attributes).toEqual(["@unique", '@default("a//b")']);
    expect(tags).toMatchObject({ field: "tags", optional: false, isList: true, doc: "" });
    expect(extra).toBeUndefined();
  });
});

describe("the classification", () => {
  it("reports nothing on a fully classified tree and renders a manual addition", async () => {
    entries["Visitor.nickname"] = { ...EMAIL, note: "Alias.", manual: true };

    const inventory = await build();

    expect(inventory.problems).toEqual([]);
    expect(inventory.markdown).toMatch(/\| `nickname` +\| `String\?` +\| personal \(manual\)/);
  });

  it.each<[string, () => void, string]>([
    ["an unclassified field", () => (schema += "model Probe {\n  ssn String\n}\n"), "Probe.ssn is"],
    ["an entry whose field is gone", () => (entries["Visitor.gone"] = EMAIL), "Visitor.gone is"],
    ["pending above baseline", setEmail({ status: "pending" }), "exceed pendingBaseline 0"],
    ["pending below baseline", () => (pendingBaseline = 1), "stale pendingBaseline 1"],
    ["manual on a matched field", setEmail({ manual: true }), "manual true, vocabulary matches"],
    ["a stray entry", () => (entries["Visitor.nickname"] = EMAIL), "vocabulary misses"],
    ["zero models", () => (schema = ""), "yielded zero models"],
    ["zero candidates", () => (schema = "model Tag {\n  id String @id\n}\n"), "zero candidates"],
  ])("refuses %s", async (_case, plant, expected) => {
    plant();

    const inventory = await build();

    expect([...inventory.problems, inventory.scopeError].join("\n")).toContain(expected);
  });
});

describe("the page hash", () => {
  it("leaves the page byte-identical on a schema edit that changes no row", async () => {
    const before = await build();
    schema = `// Visitors.\n${schema.replace("nickname String?\n", "nickname String?\n  @@index([email])\n")}`;

    expect((await build()).markdown).toBe(before.markdown);
  });

  it("leaves the page byte-identical when a model with no candidate field is added", async () => {
    const before = await build();
    schema += "\nmodel Tag {\n  id String @id\n  label String\n}\n";

    expect((await build()).markdown).toBe(before.markdown);
  });

  it("moves the scan hash when a candidate is planted", async () => {
    const before = await build();
    schema = schema.replace("nickname String?\n", "nickname String?\n  phone String\n");

    expect(provenance((await build()).markdown)).not.toBe(provenance(before.markdown));
  });
});

describe("the generator's stdout", () => {
  it("prints nothing when the scan fails closed", async () => {
    const printed: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => printed.push(`${chunk}`) > 0);
    put(SCHEMA, "enum Kind {\n  A\n}\n");

    const { scopeError } = await generator.generate({ root });

    expect(scopeError).toContain("yielded zero models");
    expect(printed).toEqual([]);
  });
});

describe("the runner", () => {
  const RUNNER = path.join(REPO_ROOT, "scripts/legal/run.mjs");

  it.each([
    ["no value", ["--only"]],
    ["a flag as its value", ["--only", "--check"]],
  ])("refuses --only with %s before any generator runs", (_case, args) => {
    const run = spawnSync(process.execPath, [RUNNER, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("usage: run.mjs [--check] [--only <name>]");
    expect(run.stdout).toBe("");
  });
});

describe("the real tree", () => {
  // The byte equality is the gate's content by design: the page moves only when a row does.
  it("prints the model count, reports no problem and equals the committed page", async () => {
    const printed: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => printed.push(`${chunk}`) > 0);

    const inventory = await generator.generate();

    expect(printed).toEqual([
      expect.stringMatching(/^legal-inventory personal-data: scanned \d+ models\n$/),
    ]);
    expect(inventory.problems).toEqual([]);
    expect(inventory.markdown).not.toContain("models scanned");
    expect(inventory.markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
