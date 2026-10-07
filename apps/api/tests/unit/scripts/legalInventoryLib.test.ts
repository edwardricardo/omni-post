/**
 * @file legalInventoryLib.test.ts
 * @description Pins `scripts/legal/lib/inventory.mjs`, the library every legal inventory generator
 *   runs on: the classification file's validation, a page rendered through Prettier and stable
 *   byte for byte, the committed-page comparison, and the runner's write and check modes,
 *   including the scope error that fails closed. A fixture generator in a scratch directory drives
 *   the runner, so the suite reads no generator and no file of the repository.
 * @layer infrastructure
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import prettier from "prettier";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Entry = Record<string, unknown>;
type Allowed = {
  statuses: string[];
  categories: string[];
  subjects: string[];
  listFields?: Record<string, string[]>;
};
type Inventory = { pagePath: string; markdown: string; problems: string[]; scopeError?: string };
type Generator = { name: string; generate: () => Promise<Inventory> };
type Page = {
  title: string;
  intro: string[];
  generatorPath: string;
  pagePath: string;
  sources: Record<string, string>;
  summary: Record<string, number>;
  columns: string[];
  rows: string[][];
};
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Library = {
  sha256Of: (text: string) => string;
  loadClassification: (
    root: string,
    file: string,
    allowed: Allowed
  ) => { entries: Map<string, Entry>; pendingBaseline: number; problems: string[]; text: string };
  renderInventory: (page: Page) => Promise<string>;
  checkInventory: (input: Inventory & { root: string }) => { ok: boolean; problems: string[] };
  runGenerators: (
    generators: Generator[],
    options: { check?: boolean; only?: string | null; root: string }
  ) => Promise<number>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const LIBRARY = path.join(REPO_ROOT, "scripts/legal/lib/inventory.mjs");
const { sha256Of, loadClassification, renderInventory, checkInventory, runGenerators } =
  (await import(LIBRARY)) as Library;

const ALLOWED = {
  statuses: ["personal", "not-personal"],
  categories: ["contact"],
  subjects: ["x"],
  extraFields: { lifetime: false },
};
const VALID = { status: "personal", category: "contact", subject: "x", note: "Address." };
const FILE = "classification.json";
const PAGE = "docs/legal/inventories/fixture.generated.md";
const RUN = "run pnpm legal:inventory";
const FIXTURE_PAGE: Page = {
  title: "Fixture inventory",
  intro: ["What the fixture page lists."],
  generatorPath: "scripts/legal/fixture.mjs",
  pagePath: PAGE,
  sources: { "a.txt": "abc123abc123" },
  summary: { rows: 1 },
  columns: ["Key", "Note"],
  rows: [["Visitor.email", "x | y"]],
};

let root = "";
let output: string[] = [];

const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const page = (): string | null =>
  existsSync(path.join(root, PAGE)) ? readFileSync(path.join(root, PAGE), "utf8") : null;
const entry = (overrides: Entry): Entry => ({
  pendingBaseline: 0,
  entries: { "Visitor.email": { ...VALID, ...overrides } },
});
const fixture = (inventory: Partial<Inventory>, name = "fixture"): Generator => ({
  name,
  generate: () =>
    Promise.resolve({ pagePath: PAGE, markdown: "# Page\n", problems: [], ...inventory }),
});
const record = (chunk: string | Uint8Array): boolean => output.push(String(chunk)) > 0;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "legal-inventory-lib-test-"));
  output = [];
  vi.spyOn(process.stdout, "write").mockImplementation(record);
  vi.spyOn(process.stderr, "write").mockImplementation(record);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("sha256Of", () => {
  it("returns the first 12 hex digits of the sha256 of the text", () => {
    expect(sha256Of("")).toBe("e3b0c44298fc");
  });
});

describe("loadClassification", () => {
  it("reads the entries sorted by key, the baseline and the raw text", () => {
    const text = JSON.stringify({
      pendingBaseline: 2,
      entries: { "b.y": { status: "not-personal", note: "B." }, "a.x": { ...VALID, manual: true } },
    });
    put(FILE, text);

    const classification = loadClassification(root, FILE, ALLOWED);

    expect(classification.problems).toEqual([]);
    expect([...classification.entries.keys()]).toEqual(["a.x", "b.y"]);
    expect(classification).toMatchObject({ pendingBaseline: 2, text });
  });

  it.each<[string, string | Entry | null, string]>([
    ["a missing file", null, `${FILE} is not JSON`],
    ["text that is not JSON", "{", `${FILE} is not JSON`],
    ["entries that are not an object", { pendingBaseline: 0, entries: [] }, "no object of entries"],
    ["a negative baseline", { pendingBaseline: -1, entries: {} }, "pendingBaseline is not a non"],
    ["an invalid status", entry({ status: "maybe" }), 'has status "maybe"'],
    ["an invalid category", entry({ category: "gossip" }), 'has category "gossip"'],
    ["a personal entry with no category", entry({ category: undefined }), "has category undefined"],
    ["a personal entry with no subject", entry({ subject: undefined }), "has subject undefined"],
    ["an entry with no note", entry({ note: "" }), "Visitor.email has no note"],
    ["an unknown key", entry({ catgory: "contact" }), "has unknown keys catgory"],
    ["manual other than true", entry({ manual: false }), "has manual false, not true or absent"],
    ["an empty extra field", entry({ lifetime: "" }), "Visitor.email has no lifetime"],
  ])("refuses %s", (_case, body, expected) => {
    if (body !== null) put(FILE, typeof body === "string" ? body : JSON.stringify(body));

    const { problems } = loadClassification(root, FILE, ALLOWED);

    expect(problems.join("\n")).toContain(expected);
  });

  it("accepts a declared extra field and requires one declared as required", () => {
    put(
      FILE,
      JSON.stringify({ pendingBaseline: 0, entries: { a: { ...VALID, owner: "o" }, b: VALID } })
    );
    const allowed = { ...ALLOWED, extraFields: { owner: true } };

    expect(loadClassification(root, FILE, allowed).problems).toEqual([`${FILE}: b has no owner`]);
  });

  describe("a list field", () => {
    const LISTED = { ...ALLOWED, listFields: { sources: ["a", "b"] } };

    it.each<[string, unknown]>([
      ["absent", undefined],
      ["empty", []],
      ["holding a repeated value", ["a", "a"]],
      ["holding a value outside the set", ["a", "c"]],
      ["a plain string", "a"],
    ])("is refused when %s", (_case, sources) => {
      put(FILE, JSON.stringify(entry({ sources })));

      expect(loadClassification(root, FILE, LISTED).problems).toEqual([
        `${FILE}: Visitor.email has sources ${JSON.stringify(sources)}, not a non-empty list of distinct a|b`,
      ]);
    });

    it("is accepted as a list of distinct allowed values, and is no unknown key", () => {
      put(FILE, JSON.stringify(entry({ sources: ["b", "a"] })));

      expect(loadClassification(root, FILE, LISTED).problems).toEqual([]);
    });
  });
});

describe("renderInventory", () => {
  it("renders the sources, the summary and an escaped table, as Prettier writes it", async () => {
    const [first, second] = [
      await renderInventory(FIXTURE_PAGE),
      await renderInventory(FIXTURE_PAGE),
    ];
    const config = await prettier.resolveConfig(path.join(REPO_ROOT, PAGE), { editorconfig: true });

    expect(first).toContain("# Fixture inventory");
    expect(first).toContain("from `a.txt` (sha256 `abc123abc123`)");
    expect(first).toMatch(/\| rows +\| 1 +\|/);
    expect(first).toContain("x \\| y");
    expect(second).toBe(first);
    expect(await prettier.check(first, { ...config, parser: "markdown" })).toBe(true);
  });
});

describe("checkInventory", () => {
  it("passes an identical page and refuses a missing or differing one", () => {
    const inventory = { root, pagePath: PAGE, markdown: "# Page\n", problems: [] };

    expect(checkInventory(inventory).problems).toEqual([`${PAGE} is missing: ${RUN}`]);
    put(PAGE, "# Page\n");
    expect(checkInventory(inventory)).toEqual({ ok: true, problems: [] });
    put(PAGE, "# Page\nedited\n");
    expect(checkInventory(inventory).problems).toEqual([
      `${PAGE} differs from the regenerated page: ${RUN}`,
    ]);
  });

  it("keeps the generator's problems on an identical page", () => {
    put(PAGE, "# Page\n");

    const verdict = checkInventory({ root, pagePath: PAGE, markdown: "# Page\n", problems: ["P"] });

    expect(verdict).toEqual({ ok: false, problems: ["P"] });
  });
});

describe("runGenerators", () => {
  it("writes the page in write mode and exits 0", async () => {
    expect(await runGenerators([fixture({})], { root })).toBe(0);
    expect(page()).toBe("# Page\n");
    expect(output).toContain(`legal-inventory fixture: wrote ${PAGE}\n`);
  });

  it("still writes the page, but exits 1, when the generator reports a problem", async () => {
    expect(await runGenerators([fixture({ problems: ["X.y has no entry"] })], { root })).toBe(1);
    expect(page()).toBe("# Page\n");
    expect(output).toContain("legal-inventory fixture: X.y has no entry\n");
  });

  it("in check mode exits 0 on a current page and 1 on a stale one, writing nothing", async () => {
    put(PAGE, "# Page\n");

    expect(await runGenerators([fixture({})], { check: true, root })).toBe(0);
    expect(await runGenerators([fixture({ markdown: "# Other\n" })], { check: true, root })).toBe(
      1
    );
    expect(page()).toBe("# Page\n");
    expect(output.join("")).toContain(`${PAGE} differs from the regenerated page`);
  });

  it.each([false, true])("fails closed on a scope error with check %s", async (check) => {
    const generators = [fixture({ scopeError: "read nothing" })];

    expect(await runGenerators(generators, { check, root })).toBe(1);
    expect(page()).toBeNull();
    expect(output).toContain("legal-inventory fixture: scope error: read nothing\n");
  });

  it.each([false, true])(
    "prints a scope error's problems beside it with check %s",
    async (check) => {
      const generators = [fixture({ scopeError: "x", problems: ["P"] })];

      expect(await runGenerators(generators, { check, root })).toBe(1);
      expect(output).toEqual([
        "legal-inventory fixture: scope error: x\n",
        "legal-inventory fixture: P\n",
      ]);
    }
  );

  it.each([false, true])(
    "survives a bare scope error with no problems list and keeps running with check %s",
    async (check) => {
      // The shape under test is exactly the missing field, so the result is built outside the type.
      const bare = { scopeError: "read nothing" } as unknown as Inventory;
      const generators = [{ name: "bare", generate: () => Promise.resolve(bare) }, fixture({})];

      expect(await runGenerators(generators, { check, root })).toBe(1);
      expect(output).toContain("legal-inventory bare: scope error: read nothing\n");
      expect(output.some((line) => line.startsWith("legal-inventory fixture: "))).toBe(true);
    }
  );

  it("lets a generator that throws reject the run", async () => {
    const thrower = { name: "thrower", generate: () => Promise.reject(new Error("boom")) };

    await expect(runGenerators([thrower], { root })).rejects.toThrow("boom");
  });

  it("runs only the generator --only names, and exits 1 when it names none", async () => {
    const generators = [fixture({ scopeError: "not run" }, "other"), fixture({})];

    expect(await runGenerators(generators, { only: "fixture", root })).toBe(0);
    expect(await runGenerators(generators, { only: "nope", root })).toBe(1);
    expect(output).toContain("legal-inventory: no generator is named nope\n");
  });
});
