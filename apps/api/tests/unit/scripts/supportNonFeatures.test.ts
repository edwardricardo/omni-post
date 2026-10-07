/**
 * @file supportNonFeatures.test.ts
 * @description Pins `scripts/support/non-features.mjs`: the derivation of every candidate kind
 *   (comments, tests and non-packages excluded, route groups and `dashboard` opened), each refusal
 *   of the classification against the tree and the support docs, the pending ratchet, the scope
 *   errors, a page that moves with the candidates and not with an edit that adds none, and the
 *   committed page equal to the one regenerated from the real tree. Each case runs on a scratch
 *   tree that starts green.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Built = { markdown: string; problems: string[]; scopeError?: string };
type Entry = Record<string, unknown>;
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type NonFeatures = Record<"CLASSIFICATION" | "PAGE", string> & {
  deriveCandidates: (root: string) => Record<string, string[]>;
  buildNonFeatures: (options: { root: string }) => Promise<Built>;
  generator: { generate: (options?: { root: string }) => Promise<Built> };
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const MODULE = path.join(REPO_ROOT, "scripts/support/non-features.mjs");
const { CLASSIFICATION, PAGE, ...api } = (await import(MODULE)) as NonFeatures;
const { deriveCandidates, buildNonFeatures, generator } = api;

const QUEUES = "packages/adapters/queue-bullmq/src/constants.ts";
const ROUTE = "route:posts/postRoutes.ts";
/** Every root, with members the derivation must take and members it must leave out. */
const TREE: Record<string, string> = {
  "apps/api/src/posts/postRoutes.ts": 'fastify.get(\n  "/posts",\n  handler\n);\n',
  "apps/api/src/auth/providerOAuth.ts":
    'app.post<{ Body: Generate<Text> }>("/ai/generate", handler);\n',
  "apps/api/src/admin/auth/guard.ts": "// fastify.get('/protected', handler);\n",
  "apps/api/src/lib/client.ts": 'http.get("https://example.test/posts");\n',
  "apps/api/src/posts/tests/postRoutes.test.ts": 'app.get("/test", handler);\n',
  "packages/core/posts/package.json": "{}",
  "packages/core/application/package.json": "{}",
  "packages/core/src/index.ts": "",
  "apps/workers/src/publishWorker.ts": "",
  "apps/workers/src/publishHandler.ts": "",
  "apps/workers/src/publishWorker.test.ts": "",
  "apps/workers/src/lib/retryHandler.ts": "",
  [QUEUES]:
    'export const QUEUE_NAMES = { PUBLISH: "publish", /** Closes } early */ DLQ: "dlq",\n} as const;\n',
  "apps/admin/app/[locale]/(auth)/login/page.tsx": "",
  "apps/admin/app/[locale]/(dashboard)/billing/page.tsx": "",
  "apps/admin/app/[locale]/reset-password/page.tsx": "",
  "apps/admin/app/[locale]/layout.tsx": "",
  "apps/client/app/[locale]/dashboard/posts/page.tsx": "",
  "apps/client/app/[locale]/login/page.tsx": "",
  "docs/support/publishing.md": "",
  "docs/support/README.md": "",
};
const DERIVED = {
  route: ["auth/providerOAuth.ts", "posts/postRoutes.ts"],
  package: ["application", "posts"],
  worker: ["publishHandler.ts", "publishWorker.ts"],
  queue: ["dlq", "publish"],
  admin: ["billing", "login", "reset-password"],
  client: ["login", "posts"],
};

let root = "";
let entries: Record<string, Entry | undefined> = {};
let pendingBaseline = 0;
let output: string[] = [];

const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const build = (): Promise<Built> => {
  put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
  return buildNonFeatures({ root });
};
const sorted = (derived: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(derived).map(([kind, names]) => [kind, [...names].sort()]));
const record = (chunk: string | Uint8Array): boolean => output.push(String(chunk)) > 0;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "support-non-features-test-"));
  Object.entries(TREE).forEach(([file, text]) => put(file, text));
  const ids = Object.entries(DERIVED).flatMap(([kind, names]) => names.map((n) => `${kind}:${n}`));
  entries = Object.fromEntries(ids.map((id) => [id, { status: "pending" }]));
  entries["package:application"] = { status: "non-feature", note: "A layer." };
  entries[ROUTE] = { status: "documented", doc: "publishing" };
  pendingBaseline = ids.length - 2;
  output = [];
  vi.spyOn(process.stdout, "write").mockImplementation(record);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("the derivation", () => {
  it("takes every kind from the tree, and no comment, test, non-package or nested file", () => {
    expect(sorted(deriveCandidates(root))).toEqual(DERIVED);
  });

  it("prints the count of each kind for a scan that read its scope, and nothing otherwise", async () => {
    put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
    await generator.generate({ root });
    rmSync(path.join(root, "apps/workers/src"), { recursive: true });
    await generator.generate({ root });

    expect(output).toEqual([
      "support-docs non-features: 2 route, 2 package, 2 worker, 2 queue, 3 admin, 2 client\n",
    ]);
  });

  it.each<[string, string[], RegExp]>([
    [
      "a missing root",
      ["apps/client/app/[locale]"],
      /^apps\/client\/app\/\[locale\] does not exist/,
    ],
    [
      "a kind with no candidate",
      ["apps/workers/src/publishHandler.ts", "apps/workers/src/publishWorker.ts"],
      /^worker yielded no candidate/,
    ],
  ])("fails closed on %s", async (_, gone, scopeError) => {
    gone.forEach((file) => rmSync(path.join(root, file), { recursive: true }));

    expect((await build()).scopeError).toMatch(scopeError);
  });
});

describe("the classification", () => {
  it("renders the non-features, the pending list and the documented map, byte-stable", async () => {
    entries["client:login"] = { status: "pending", note: "Waits for its page." };
    const [first, second] = [await build(), await build()];
    const section = (heading: string): string =>
      first.markdown.split(`## ${heading}\n`)[1]?.split("\n## ")[0]?.trim() ?? "";

    expect(first.problems).toEqual([]);
    expect(section("Non-features")).toMatch(/\| `package:application` \| A layer\. +\|$/);
    expect(section("Pending").split("\n")).toHaveLength(pendingBaseline);
    expect(section("Pending")).toMatch(/^- `admin:billing`\n/);
    expect(section("Pending")).toContain("\n- `client:login`: Waits for its page.\n");
    expect(section("Documented")).toMatch(
      /\| \[publishing\]\(publishing\.md\) \| `route:posts\/postRoutes\.ts` +\|$/
    );
    expect(first.markdown).toMatch(/\| pending +\| 11 +\|/);
    expect(second.markdown).toBe(first.markdown);
  });

  it("keeps the page on an edit that adds no candidate, and moves it with one that does", async () => {
    const before = (await build()).markdown;
    put("apps/api/src/posts/postRoutes.ts", 'fastify.get("/posts", other);\n');
    const unchanged = (await build()).markdown;
    put("apps/api/src/feed/feedRoutes.ts", "");
    entries["route:feed/feedRoutes.ts"] = { status: "pending" };
    pendingBaseline += 1;
    const after = await build();

    expect(unchanged).toBe(before);
    expect(after.problems).toEqual([]);
    expect(after.markdown).toContain("- `route:feed/feedRoutes.ts`\n");
  });

  /** One refusal per row: what it is | the entry changed | its new value, `-` to drop it | the problem. */
  const REFUSALS = String.raw`
an unclassified candidate | queue:dlq | - | queue:dlq has no entry: classify it
an entry the tree does not yield | queue:gone | {"status":"pending"} | queue:gone is classified but the tree yields no such candidate
a doc that is no support doc | ${ROUTE} | {"status":"documented","doc":"shipping"} | ${ROUTE} is documented by shipping, which is no support doc
a documented entry without its doc | ${ROUTE} | {"status":"documented"} | ${ROUTE} is documented by no doc, which is no support doc
a doc on an entry that is not documented | client:posts | {"status":"pending","doc":"publishing"} | client:posts: doc belongs on a documented candidate, and only there
a non-feature without its reason | package:application | {"status":"non-feature"} | ${CLASSIFICATION}: package:application has no note
more pending than the baseline | pendingBaseline | 10 | 11 pending exceed pendingBaseline 10
a baseline above the pending count | pendingBaseline | 12 | stale pendingBaseline 12: lower it to 11`
    .trim()
    .split("\n")
    .map((row) => row.split(" | "));

  it.each(REFUSALS)("refuses %s", async (title, id, value, problem, ...extra) => {
    expect([title, id, value, problem, ...extra].filter(Boolean)).toHaveLength(4);
    if (id === "pendingBaseline") pendingBaseline = Number(value);
    else entries[id] = value === "-" ? undefined : (JSON.parse(value) as Entry);

    expect((await build()).problems).toContain(problem);
  });

  it("finds the real tree clean and its committed page current", async () => {
    const built = await buildNonFeatures({ root: REPO_ROOT });

    expect(built.problems).toEqual([]);
    expect(built.markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
