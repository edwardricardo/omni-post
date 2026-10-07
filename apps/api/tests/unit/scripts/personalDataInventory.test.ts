/**
 * @file personalDataInventory.test.ts
 * @description Pins `scripts/legal/personal-data.mjs`, the first legal inventory: the schema
 *   parser, candidates by name segment, the refusals that join candidates with the classification,
 *   and, over the real tree, a committed page equal byte for byte to the regenerated one. Each
 *   refusal is proven on a scratch fixture tree that starts green; the validation, rendering and
 *   runner rules of `scripts/legal/lib/inventory.mjs` are pinned by `legalInventoryLib.test.ts`.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GENERATOR = path.join(REPO_ROOT, "scripts/legal/personal-data.mjs");
const { SCHEMA, CLASSIFICATION, PAGE, parsePrismaSchema, findCandidates, buildInventory } =
  (await import(GENERATOR)) as Generator;

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

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "personal-data-inventory-test-"));
  schema = "model Visitor {\n  id String @id\n  email String\n  nickname String?\n}\n";
  [entries, pendingBaseline] = [{ "Visitor.email": EMAIL }, 0];
});

afterEach(() => {
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

describe("the real tree", () => {
  it("over the real tree: no problem, and the committed page equals the regenerated one", async () => {
    const inventory = await buildInventory({ root: REPO_ROOT });

    expect(inventory.problems).toEqual([]);
    expect(inventory.markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
