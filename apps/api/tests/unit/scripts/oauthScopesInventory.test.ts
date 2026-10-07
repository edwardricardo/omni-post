/**
 * @file oauthScopesInventory.test.ts
 * @description Pins `scripts/legal/oauth-scopes.mjs`: the readers of the connect-flow, shared and
 *   adapter scope literals and of the CRM authorize routes, the sources derived per scope, the
 *   Mismatches section, the classification refusals and scope errors, and the committed page
 *   equal byte for byte to the one regenerated from the real tree. Each case runs on a scratch
 *   tree that starts green; the `listFields` rules are pinned by `legalInventoryLib.test.ts`.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Inventory = { pagePath: string; markdown: string; problems: string[]; scopeError?: string };
type Entry = Record<string, unknown>;
type Scopes = { values: string[]; unread: string[] };
type Crm = [string, RegExp, RegExp];
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Generator = Record<"SCHEMA" | "LOGIN" | "SHARED" | "CRM_ROUTES" | "CLASSIFICATION", string> & {
  PAGE: string;
  recordEntries: (code: string, name: string) => Array<[string, string]> | null;
  routeBlock: (code: string, route: string) => string | null;
  providerEnum: (schema: string) => string[];
  scopesIn: (text: string, code: string, property: string) => Scopes;
  buildInventory: (options: { root: string; crms?: Crm[] }) => Promise<Inventory>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GENERATOR = path.join(REPO_ROOT, "scripts/legal/oauth-scopes.mjs");
const { SCHEMA, LOGIN, SHARED, CRM_ROUTES, CLASSIFICATION, PAGE, ...api } = (await import(
  GENERATOR
)) as Generator;
const { recordEntries, routeBlock, providerEnum, scopesIn, buildInventory } = api;

const X_ADAPTER = "packages/providers/x/src/XAdapter.ts";
const WEB = "packages/providers/web/src/WebAdapter.ts";
const THREADS = "packages/providers/threads/src/ThreadsAdapter.ts";
const ALL = ["login", "adapter", "shared"];
const LOGIN_TEXT = `export const oauthProviders: Record<P, O> = {
  x: { id: "x", config: { redirectUri: "https://a.b/c", scopes: ["a", "b"] } },
  threads: createUnimplementedProvider("threads"),
};`;
const CRM_TEXT = `app.get("/crm/hubspot/authorize", async () => { const scopes = "h1 h2"; });
app.get("/crm/salesforce/authorize", async () => \`x?a=1&scope=s1+s2\`);`;
const HUBSPOT_LITERAL = /\bscopes\s*=\s*"([^"]+)"/;
const CRM_DECOY = `app.get("/crm/hubspot/authorize", async () => url);
app.post("/crm/hubspot/callback", async () => { const scopes = "decoy"; });
app.get("/crm/salesforce/authorize", async () => \`x?scope=s1\`);`;

let root = "";
let entries: Record<string, Entry> = {};
let pendingBaseline = 0;

const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const remove = (file: string): void => rmSync(path.join(root, file), { recursive: true });
const build = (): Promise<Inventory> => {
  put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
  return buildInventory({ root });
};
const problemsOf = async (): Promise<string> => {
  const { problems, scopeError } = await build();
  return [...problems, scopeError ?? ""].join("\n");
};
const OK = { status: "required", grants: "G.", note: "N." };
const ok = (sources: string[]): Entry => ({ ...OK, sources });
const adapter = (scopes: string) => (): void =>
  put(X_ADAPTER, `const M = { requiredScopes: ${scopes} };`);
const blank = (file: string): void => put(file, "");
const setA = (overrides: Entry) => (): void => {
  entries["x:a"] = { ...entries["x:a"], ...overrides };
};
const provenance = (markdown: string): string =>
  markdown.split("\n").find((line) => line.startsWith("> Generated")) ?? "";
const section = (markdown: string, heading: string): string =>
  markdown.split(`## ${heading}\n`)[1]?.split("\n## ")[0]?.trim() ?? "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "oauth-scopes-inventory-test-"));
  put(SCHEMA, "model Tag {\n  id String @id\n}\n\nenum Provider {\n  X\n  THREADS // pending\n}\n");
  put(LOGIN, LOGIN_TEXT);
  put(SHARED, 'const PROVIDER_CONFIGS = { x: { requiredScopes: ["a"] }, threads: { id: "t" } };');
  put(X_ADAPTER, '// requiredScopes: ["z"]\nconst METADATA = { requiredScopes: ["a", "c"] };\n');
  put(THREADS, 'const METADATA = { id: "threads" };\n');
  put(CRM_ROUTES, CRM_TEXT);
  pendingBaseline = 0;
  const crm = ["hubspot:h1", "hubspot:h2", "salesforce:s1", "salesforce:s2"];
  entries = { "x:a": ok(ALL), "x:b": ok(["login"]), "x:c": ok(["adapter"]) };
  crm.forEach((key) => (entries[key] = ok(["crm"])));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the scan", () => {
  it("reads each enum value's first token, keeping a colon and skipping block attributes", () => {
    const schema = 'enum Provider {\n  X @map("x")\n  A:B // note\n\n  @@map("p")\n}\n';

    expect(providerEnum(schema)).toEqual(["x", "a:b"]);
  });

  it("read each record entry's nested scopes, and a stub entry as none", () => {
    const [x, threads] = recordEntries(LOGIN_TEXT, "oauthProviders") ?? [];

    expect([x?.[0], threads?.[0]]).toEqual(["x", "threads"]);
    expect(scopesIn(LOGIN_TEXT, x?.[1] ?? "", "scopes")).toEqual({
      values: ["a", "b"],
      unread: [],
    });
    expect(scopesIn(LOGIN_TEXT, threads?.[1] ?? "", "scopes")).toEqual({ values: [], unread: [] });
  });

  it.each<[string, string, string, string[] | null]>([
    ["a name holding a regex metacharacter", "const a$b = { k: 1 };", "a$b", ["k"]],
    ["a second declaration", "const r = { k: 1 };\nconst r = { k: 2 };", "r", null],
    ["no declaration", "const q = { k: 1 };", "r", null],
  ])("read a record from code holding %s", (_case, code, name, keys) => {
    expect(recordEntries(code, name)?.map(([key]) => key) ?? null).toEqual(keys);
  });

  it.each<[string, string, string | null]>([
    [
      "the last route, to the end of the file",
      'x();\napp.get("/r", () => 1);',
      'app.get("/r", () => 1);',
    ],
    [
      "a route before another, up to it",
      'app.get("/r", f);\napp.post("/q", g);',
      'app.get("/r", f);\n',
    ],
    [
      "a path quoted first in a redirect",
      'const to = "/r";\napp.get("/q", g);\napp.get("/r", f);',
      'app.get("/r", f);',
    ],
    ["no route with that path", 'const to = "/r";\napp.get("/q", g);', null],
  ])("bound the block of %s", (_case, code, block) => {
    expect(routeBlock(code, "/r")).toBe(block);
  });

  it.each<[string, string, string[], string[]]>([
    ["a literal array", 'requiredScopes: ["a", `b`]', ["a", "b"], []],
    ["no literal", 'id: "x"', [], []],
    ["an element it cannot resolve", "requiredScopes: [SCOPE]", [], ["SCOPE"]],
    ["a value that is no array", "requiredScopes: SCOPES, x: 1", [], ["SCOPES"]],
    ["a longer name ending in it", 'xrequiredScopes: ["a"]', [], []],
  ])("read an adapter holding %s", (_case, body, values, unread) => {
    const code = `const M = { ${body} };`;

    expect(scopesIn(code, code, "requiredScopes")).toEqual({ values, unread });
  });

  it("derives each scope's sources and lists only the partial social scopes as mismatches", async () => {
    const [first, second] = [await build(), await build()];

    expect(first.problems).toEqual([]);
    expect(first.markdown).toMatch(/\| x +\| `a` +\| login, adapter, shared \| required /);
    expect(first.markdown).toMatch(/\| social +\| x +\| `b` +\| login +\|/);
    expect(first.markdown).toMatch(/\| crm +\| salesforce +\| `s2` +\| crm +\|/);
    expect(section(first.markdown, "Mismatches").split("\n").slice(2)).toEqual([
      "- **x** `b`: declared by login; missing from adapter, shared.",
      "- **x** `c`: declared by adapter; missing from login, shared.",
    ]);
    expect(section(first.markdown, "Providers without scopes")).toBe("- `threads` (social)");
    expect(second.markdown).toBe(first.markdown);
  });

  it("reads a CRM literal from its registration when a redirect quotes the path first", async () => {
    put(
      CRM_ROUTES,
      `const back = "/crm/hubspot/authorize";\napp.get("/crm/back", () => back);\n${CRM_TEXT}`
    );

    const { problems, scopeError } = await build();

    expect([scopeError, problems]).toEqual([undefined, []]);
  });

  it("refuses a CRM name holding a colon through the CRM reader", async () => {
    put(CRM_ROUTES, 'app.get("/crm/hub:spot/authorize", async () => { const scopes = "h1"; });');
    put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
    const crms: Crm[] = [["hub:spot", HUBSPOT_LITERAL, /\s+/]];

    const { scopeError, problems } = await buildInventory({ root, crms });

    expect(scopeError).toContain('provider hub:spot holds ":"');
    expect(problems).toEqual([]);
  });

  it("refuses a colon-bearing provider before reading any source, so the error carries no row", async () => {
    put(SCHEMA, "enum Provider {\n  A:B\n}\n");

    const { scopeError, problems, markdown } = await build();

    expect(scopeError).toContain('provider a:b holds ":"');
    expect([problems, markdown]).toEqual([[], ""]);
  });

  it("refuses a CRM listed twice", async () => {
    put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
    const hubspot: Crm = ["hubspot", HUBSPOT_LITERAL, /\s+/];

    const { scopeError } = await buildInventory({ root, crms: [hubspot, hubspot] });

    expect(scopeError).toContain("CRM hubspot is listed more than once");
  });

  it("hashes the scan result, so only a scope, source or provider change moves the page", async () => {
    const before = await build();
    put(X_ADAPTER, '// reworded\nconst METADATA = { name: "X", requiredScopes: ["a", "c"] };\n');
    put(CRM_ROUTES, `// routes\n${CRM_TEXT}\napp.get("/crm/other", () => 1);\n`);
    const unrelated = await build();
    adapter('["a", "c", "d"]')();
    const changed = await build();

    expect(unrelated.markdown).toBe(before.markdown);
    expect(provenance(changed.markdown)).not.toBe(provenance(before.markdown));
  });
});

describe("the classification", () => {
  it.each<[string, () => void, string]>([
    ["a new candidate", adapter('["d"]'), "x:d is a candidate with no entry"],
    ["a stale key", () => (entries["x:gone"] = ok(["login"])), "x:gone is classified but no"],
    ["sources unlike the scan", setA({ sources: ["login"] }), "x:a declares login, the scan finds"],
    ["sources that are no list", setA({ sources: "login" }), 'x:a has sources "login", not a'],
    ["an invalid status", setA({ status: "personal" }), 'x:a has status "personal"'],
    ["an entry with no grants", setA({ grants: undefined }), "x:a has no grants"],
    ["pending above baseline", setA({ status: "pending" }), "1 pending exceed pendingBaseline 0"],
    ["pending below baseline", () => (pendingBaseline = 1), "stale pendingBaseline 1"],
    ["an element that is no literal", adapter('["a", "c", N]'), `${X_ADAPTER}: N is no string`],
    ["an adapter outside the enum", () => blank(WEB), "web is no Provider value"],
  ])("refuses %s", async (_case, plant, expected) => {
    plant();

    expect(await problemsOf()).toContain(expected);
  });

  it("refuses an adapter outside the enum without collecting its scopes", async () => {
    put(WEB, 'const M = { requiredScopes: ["w"] };');

    const { problems, markdown } = await build();

    expect(problems).toEqual([
      `${WEB}: web is no Provider value, so none of its scopes is collected`,
    ]);
    expect(markdown).not.toContain("`w`");
  });

  it.each<[string, () => void, string]>([
    ["a missing source", () => remove(SHARED), `${SHARED} does not exist`],
    ["zero enum providers", () => put(SCHEMA, "enum Kind {\n  A\n}\n"), "zero Provider enum"],
    ["zero adapter files", () => [X_ADAPTER, THREADS].forEach(remove), "zero adapter files"],
    [
      "zero social scopes",
      () => {
        put(LOGIN, "const oauthProviders = {};");
        put(SHARED, "const PROVIDER_CONFIGS = {};");
        blank(X_ADAPTER);
      },
      "the social sources yielded zero scopes",
    ],
    [
      "a second record declaration",
      () => put(LOGIN, `${LOGIN_TEXT}\nconst oauthProviders = {};`),
      `${LOGIN} does not declare const oauthProviders exactly once`,
    ],
    [
      "a provider name holding a colon",
      () => put(SCHEMA, "enum Provider {\n  A:B\n}"),
      "a:b holds",
    ],
    ["a CRM route missing", () => blank(CRM_ROUTES), "it has no /crm/hubspot/authorize route"],
    [
      "a literal only in a later route",
      () => put(CRM_ROUTES, CRM_DECOY),
      "its /crm/hubspot/authorize route holds no scope literal",
    ],
  ])("fails closed on %s", async (_case, plant, expected) => {
    plant();

    expect((await build()).scopeError).toContain(expected);
  });
});

describe("the real tree", () => {
  it("reports no problem, shows the unrequested Instagram publish scope, equals the page", async () => {
    const { problems, markdown } = await buildInventory({ root: REPO_ROOT });

    expect(problems).toEqual([]);
    expect(section(markdown, "Mismatches")).toContain(
      "- **instagram** `instagram_content_publish`: declared by adapter, shared; missing from login."
    );
    // The committed page is the gate's content by design; its scan hash moves only on a legal change.
    expect(markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
