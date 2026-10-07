/**
 * @file cookiesAndStorageInventory.test.ts
 * @description Pins `scripts/legal/cookies-and-storage.mjs`: sites grouped per app, kind and name
 *   with the attributes a cookie sets, an unresolved name refused until `resolvesTo` documents it,
 *   the classification refusals and scope errors, and the committed page equal byte for byte to
 *   the one regenerated from the real tree. Each case runs on a scratch tree holding every root,
 *   which starts green; the scanner's own rules are pinned by `legalSourceScan.test.ts`.
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
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Generator = { CLASSIFICATION: string; PAGE: string; ROOTS: readonly string[] } & {
  buildInventory: (options: { root: string }) => Promise<Inventory>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GENERATOR = path.join(REPO_ROOT, "scripts/legal/cookies-and-storage.mjs");
const { CLASSIFICATION, PAGE, ROOTS, buildInventory } = (await import(GENERATOR)) as Generator;

const SID = { status: "essential", lifetime: "1 minute", note: "Session." };
const KEEP = { status: "functional", lifetime: "until cleared", note: "Preference." };

let root = "";
let entries: Record<string, Entry> = {};
let pendingBaseline = 0;

const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const build = (): Promise<Inventory> => {
  put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
  return buildInventory({ root });
};
const problemsOf = async (): Promise<string> => {
  const { problems, scopeError } = await build();
  return [...problems, scopeError ?? ""].join("\n");
};
const setSid = (overrides: Entry) => (): void => {
  entries["api:cookie:sid"] = { ...SID, ...overrides };
};
const remove = (file: string) => (): void => rmSync(path.join(root, file), { recursive: true });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "cookies-and-storage-inventory-test-"));
  ROOTS.forEach((dir) => (dir.endsWith(".ts") ? put(dir, "") : put(`${dir}/.keep`, "")));
  put("apps/api/src/auth.ts", 'reply.setCookie("sid", token, { httpOnly: true, domain: "x" });\n');
  [entries, pendingBaseline] = [{ "api:cookie:sid": SID }, 0];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the candidates", () => {
  it("group every site per app, kind and name, with the attributes, in the same bytes twice", async () => {
    put("apps/api/src/logout.ts", 'reply.clearCookie("sid");\n');
    const store = "const store = await cookies();\nstore.set(NAME, t, { ...BASE, maxAge: 1 });\n";
    put("apps/admin/lib/session.ts", `export const NAME = "s";\n${store}store.delete(NAME);\n`);
    put(
      "apps/admin/hooks/prefs.ts",
      'localStorage.removeItem("gone");\nsessionStorage.getItem("seen");'
    );
    put("apps/client/proxy.ts", 'response.cookies.set("locale", value);\n');
    put("apps/client/components/theme.tsx", 'document.cookie = "theme=dark; path=/";\n');
    const added = {
      "admin:cookie:s": SID,
      "client:cookie:locale": KEEP,
      "client:cookie:theme": KEEP,
    };
    Object.assign(entries, added, {
      "admin:localStorage:gone": KEEP,
      "admin:sessionStorage:seen": KEEP,
    });

    const [first, second] = [await build(), await build()];

    expect(first.problems).toEqual([]);
    expect(first.markdown).toContain(
      "apps/api/src/auth.ts:1 (set), apps/api/src/logout.ts:1 (clear)"
    );
    expect(first.markdown).toContain("`{ httpOnly: true }`");
    expect(first.markdown).toContain("`{ ...BASE, maxAge: 1 }`");
    expect(first.markdown).toContain(
      "apps/admin/lib/session.ts:3 (set), apps/admin/lib/session.ts:4 (clear)"
    );
    expect(first.markdown).toContain("apps/admin/hooks/prefs.ts:2 (read)");
    expect(first.markdown).toMatch(
      /\| client +\| cookie +\| `theme` .*components\/theme\.tsx:1 \(set\)/
    );
    expect(second.markdown).toBe(first.markdown);
  });

  it("refuse a name its file does not state until resolvesTo documents it", async () => {
    const write = "window.localStorage.setItem(\n  draftKey,\n  value\n);\n";
    put("apps/client/lib/draft.ts", `const draftKey = \`draft_\${id}\`;\n${write}`);
    const key = "client:localStorage:unresolved:draftKey";

    expect(await problemsOf()).toContain(`${key} is a candidate with no entry: document it`);
    entries[key] = { ...KEEP, resolvesTo: "draft_<id>" };
    const { problems, markdown } = await build();

    expect(problems).toEqual([]);
    expect(markdown).toContain("`draft_<id>` (from `draftKey`)");
    expect(markdown).toContain("apps/client/lib/draft.ts:2 (set)");
  });
});

describe("the classification", () => {
  it.each<[string, () => void, string]>([
    ["a new candidate", () => put("apps/api/src/b.ts", 'res.cookie("b", v);'), "api:cookie:b is a"],
    [
      "a stale key",
      () => (entries["api:cookie:gone"] = SID),
      "gone is classified but no call site",
    ],
    ["pending above baseline", setSid({ status: "pending" }), "1 pending exceed pendingBaseline 0"],
    ["pending below baseline", () => (pendingBaseline = 1), "stale pendingBaseline 1"],
    ["an invalid status", setSid({ status: "personal" }), 'has status "personal"'],
    [
      "an entry with no lifetime",
      setSid({ lifetime: undefined }),
      "api:cookie:sid has no lifetime",
    ],
    ["manual on a candidate", setSid({ manual: true }), "manual, but call sites name it"],
    ["resolvesTo on a resolved name", setSid({ resolvesTo: "s" }), "resolvesTo belongs on an"],
    ["a key of another shape", () => (entries["web:cookie:x"] = SID), "web:cookie:x is not <app>"],
    ["a missing root", remove("apps/client/providers"), "apps/client/providers does not exist"],
    ["a missing file root", remove("apps/admin/proxy.ts"), "apps/admin/proxy.ts does not exist"],
    ["zero call sites", remove("apps/api/src/auth.ts"), "zero call sites"],
  ])("refuses %s", async (_case, plant, expected) => {
    plant();

    expect(await problemsOf()).toContain(expected);
  });
});

describe("the real tree", () => {
  it("reports no problem, lists the API refresh and admin session cookies, equals the page", async () => {
    const { problems, markdown } = await buildInventory({ root: REPO_ROOT });

    expect(problems).toEqual([]);
    expect(markdown).toMatch(/\| api +\| cookie +\| `refreshToken` +\| essential /);
    expect(markdown).toMatch(/\| admin +\| cookie +\| `admin-session` +\| essential /);
    expect(markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
