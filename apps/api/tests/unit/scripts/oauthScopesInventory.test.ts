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
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Generator = Record<"SCHEMA" | "LOGIN" | "SHARED" | "CRM_ROUTES" | "CLASSIFICATION", string> & {
  PAGE: string;
  recordEntries: (code: string, name: string) => Array<[string, string]>;
  scopesIn: (text: string, code: string, property: string) => Scopes;
  buildInventory: (options: { root: string }) => Promise<Inventory>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GENERATOR = path.join(REPO_ROOT, "scripts/legal/oauth-scopes.mjs");
const { SCHEMA, LOGIN, SHARED, CRM_ROUTES, CLASSIFICATION, PAGE, ...api } = (await import(
  GENERATOR
)) as Generator;
const { recordEntries, scopesIn, buildInventory } = api;

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
  it("read each record entry's nested scopes, and a stub entry as none", () => {
    const [x, threads] = recordEntries(LOGIN_TEXT, "oauthProviders");

    expect([x?.[0], threads?.[0]]).toEqual(["x", "threads"]);
    expect(scopesIn(LOGIN_TEXT, x?.[1] ?? "", "scopes")).toEqual({
      values: ["a", "b"],
      unread: [],
    });
    expect(scopesIn(LOGIN_TEXT, threads?.[1] ?? "", "scopes")).toEqual({ values: [], unread: [] });
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

  it.each<[string, () => void, string]>([
    ["a missing source", () => remove(SHARED), `${SHARED} does not exist`],
    ["zero enum providers", () => put(SCHEMA, "enum Kind {\n  A\n}\n"), "zero Provider enum"],
    ["zero adapter files", () => [X_ADAPTER, THREADS].forEach(remove), "zero adapter files"],
    ["zero social scopes", () => [LOGIN, SHARED, X_ADAPTER].forEach(blank), "zero scopes"],
    ["a CRM route with no scope", () => blank(CRM_ROUTES), "no scope for hubspot, salesforce"],
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
    expect(markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
