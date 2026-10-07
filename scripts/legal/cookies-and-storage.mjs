// @ts-check
/**
 * @file cookies-and-storage.mjs
 * @description The `cookies-and-storage` legal inventory: every cookie the code sets or clears and
 *   every `localStorage` / `sessionStorage` key it writes, reads or removes, found under `ROOTS`
 *   and joined with `CLASSIFICATION` as `<app>:<kind>:<name>`. A name its own file does not state
 *   becomes `<app>:<kind>:unresolved:<file>:<argument>`, whose entry must carry `resolvesTo`; the
 *   path keeps two files' identical arguments apart. A cookie a dependency sets, which no site
 *   names, is added with `"manual": true`. A missing root or zero sites is a scope error, reported
 *   with the classification's own problems. The page holds no file count, so a source file that
 *   sets nothing never stales it; `generate` prints that count instead. A row names each file that
 *   holds its sites, with their count and actions, never a line, so an edit that only moves a call
 *   site leaves the page current.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadClassification, renderInventory, sha256Of } from "./lib/inventory.mjs";
import * as scan from "./lib/source-scan.mjs";

export const CLASSIFICATION = "docs/legal/classification/cookies-and-storage.json";
export const PAGE = "docs/legal/inventories/cookies-and-storage.generated.md";
const NEXT_DIRECTORIES = ["app", "components", "hooks", "lib", "providers"];
/**
 * Every root must exist: a root that moved would otherwise leave its cookies unscanned. Each
 * portal's `proxy.ts` is a file root, since the Next.js proxy can set a cookie on its response.
 */
export const ROOTS = Object.freeze([
  "apps/api/src",
  ...["admin", "client"].flatMap((app) => NEXT_DIRECTORIES.map((dir) => `apps/${app}/${dir}`)),
  ...["admin", "client"].map((app) => `apps/${app}/proxy.ts`),
  "packages/ui/src",
]);
const APPS = { api: "apps/api/", admin: "apps/admin/", client: "apps/client/", ui: "packages/ui/" };
const KINDS = ["cookie", "localStorage", "sessionStorage"];
const STATUSES = ["essential", "functional", "analytics", "marketing", "pending"];
const EXTRA_FIELDS = { lifetime: true, resolvesTo: false };
const ALLOWED = { statuses: STATUSES, categories: [], subjects: [], extraFields: EXTRA_FIELDS };
/** The cookie options a row shows; any other option of the literal is left out. */
const ATTRIBUTES = ["maxAge", "expires", "httpOnly", "secure", "sameSite", "path"];
const KEY_SHAPE = new RegExp(`^(?:${Object.keys(APPS).join("|")}):(?:${KINDS.join("|")}):.`);
const UNRESOLVED = /^[^:]+:[^:]+:unresolved:/;
const STORAGE_METHODS = { set: "setItem", read: "getItem", clear: "removeItem" };
/** The actions a site performs, in the order a row lists them. */
const ACTIONS = Object.keys(STORAGE_METHODS);

/** @typedef {import("./lib/inventory.mjs").Entry & { lifetime?: string, resolvesTo?: string }} StorageEntry */
/** @typedef {{ key: string, arg: string, file: string, action: string, attributes: string }} Candidate */

/**
 * The matchers of one file, named `<kind>:<action>`: the fixed forms, plus `.set(` and `.delete(`
 * on every name the file binds to `cookies()`, the way Next.js code reaches its cookie store.
 * @type {(text: string) => import("./lib/source-scan.mjs").Matcher[]}
 */
export function matchersFor(text) {
  const aliases = scan.bindingsOf(text, "cookies").map((alias) => alias.replaceAll("$", "\\$"));
  const names = ["cookies\\(\\)", "cookieStore", ...aliases].join("|");
  const store = String.raw`(?:\b(?:${names})|\.cookies)`;
  return [
    { name: "cookie:set", pattern: /\.setCookie\(|\b(?:reply|res)\.cookie\(/ },
    { name: "cookie:clear", pattern: /\.clearCookie\(/ },
    { name: "cookie:set", pattern: new RegExp(String.raw`${store}\.set\(`) },
    { name: "cookie:clear", pattern: new RegExp(String.raw`${store}\.delete\(`) },
    { name: "cookie:assign", pattern: /\bdocument\.cookie\s*=(?!=)/ },
    ...["localStorage", "sessionStorage"].flatMap((kind) =>
      Object.entries(STORAGE_METHODS).map(([action, method]) => ({
        name: `${kind}:${action}`,
        pattern: new RegExp(String.raw`\b${kind}\.${method}\(`),
      }))
    ),
  ];
}

/**
 * A site's candidate: the app owning the file, the matcher's kind and action, the name the first
 * argument resolves to, and the options shown for a cookie it sets.
 * @type {(site: import("./lib/source-scan.mjs").Site, text: string) => Candidate}
 */
export function toCandidate({ file, matcher, args }, text) {
  const app = Object.entries(APPS).find(([, prefix]) => file.startsWith(prefix))?.[0] ?? "other";
  const [kind = "", verb = ""] = matcher.split(":");
  const [arg = "", action] = [args[0], verb === "assign" ? "set" : verb];
  const resolved = scan.resolveStringArgument(text, arg);
  const name = verb === "assign" ? (resolved?.split("=")[0]?.trim() ?? null) : resolved;
  const options = kind === "cookie" && action === "set" ? (args.at(-1) ?? "") : "";
  const attributes = scan.objectEntries(options, ATTRIBUTES).join(", ");
  const key = `${app}:${kind}:${name ?? `unresolved:${file}:${arg}`}`;
  return { key, arg, file, action, attributes };
}

/**
 * Scans the roots under `root`, joins the candidates with the classification and renders the page.
 * The classification is read first, so a scope error still carries the problems of its entries;
 * the joins that need a complete scan run only once the scope is whole.
 * @type {(options?: { root?: string }) => Promise<import("./lib/inventory.mjs").Inventory & { counts?: Record<string, number>, filesScanned?: number }>}
 */
export async function buildInventory({ root = REPO_ROOT } = {}) {
  const classification = loadClassification(root, CLASSIFICATION, ALLOWED);
  const { pendingBaseline, problems } = classification;
  const entries = /** @type {Map<string, StorageEntry>} */ (classification.entries);
  for (const [key, { resolvesTo }] of entries) {
    if (!KEY_SHAPE.test(key)) problems.push(`${key} is not <app>:<kind>:<name>`);
    if (UNRESOLVED.test(key) !== (resolvesTo !== undefined))
      problems.push(`${key}: resolvesTo belongs on an unresolved name, and only there`);
  }
  const { files, missing } = scan.listSourceFiles(root, { roots: ROOTS });
  const candidates = files.flatMap((file) => {
    const text = readFileSync(path.join(root, file), "utf8");
    return scan.scanFile(file, text, matchersFor(text)).map((site) => toCandidate(site, text));
  });
  const empty = candidates.length === 0 ? "the roots yielded zero call sites" : null;
  const scope = missing.length > 0 ? `${missing.join(", ")} does not exist` : empty;
  const scopeError = `${scope}: a scan that cannot read its whole scope is not clean`;
  const filesScanned = files.length;
  if (scope !== null) return { pagePath: PAGE, markdown: "", problems, scopeError, filesScanned };
  /** @type {Map<string, Candidate[]>} */
  const byKey = new Map();
  for (const found of candidates) byKey.set(found.key, [...(byKey.get(found.key) ?? []), found]);
  for (const key of byKey.keys()) {
    const fix = UNRESOLVED.test(key) ? "document it with resolvesTo" : "classify it";
    if (!entries.has(key)) problems.push(`${key} is a candidate with no entry: ${fix}`);
  }
  for (const [key, { manual = false }] of entries) {
    if (manual && byKey.has(key)) problems.push(`${key}: manual, but call sites name it`);
    if (!manual && !byKey.has(key)) problems.push(`${key} is classified but no call site names it`);
  }
  const added = [...entries.keys()].filter((key) => entries.get(key)?.manual);
  const keys = [...new Set([...byKey.keys(), ...added])].sort();
  const statusOf = (/** @type {string} */ key) => entries.get(key)?.status ?? "unclassified";
  const tally = (/** @type {string} */ status) => keys.filter((k) => statusOf(k) === status).length;
  const pending = tally("pending");
  if (pending > pendingBaseline)
    problems.push(`${pending} pending exceed pendingBaseline ${pendingBaseline}`);
  if (pending < pendingBaseline)
    problems.push(`stale pendingBaseline ${pendingBaseline}: lower it to ${pending}`);
  const documented = [...byKey.keys()].filter((k) => UNRESOLVED.test(k) && entries.has(k)).length;
  const scanned = { sites: candidates.length, candidates: byKey.size };
  const extra = { "unresolved names documented": documented, "manual additions": added.length };
  const statuses = Object.fromEntries([...STATUSES, "unclassified"].map((s) => [s, tally(s)]));
  const counts = { ...scanned, ...extra, ...statuses };
  const markdown = await renderInventory({
    title: "Cookies and browser storage inventory",
    intro: [
      "Every cookie the code sets or clears, and every `localStorage` / `sessionStorage` key it writes, reads or removes, with its category, lifetime and purpose as the code states them.",
      "- **Not the register.** Legal basis, consent and retention are owned by `docs/legal/REGISTER.md`, never by this page.\n" +
        "- **What is scanned.** Source files under `apps/api/src`, `apps/{admin,client}/{app,components,hooks,lib,providers}` and `packages/ui/src`, plus `apps/{admin,client}/proxy.ts`. Tests, stories, declaration files, build output and `.env*` files are skipped.\n" +
        `- **How a row gets here.** Each call site's name becomes \`<app>:<kind>:<name>\`, and every one needs an entry in \`${CLASSIFICATION}\`. A name its own file does not state is documented there with \`resolvesTo\`; a cookie a dependency sets, which no call site names, is added with \`"manual": true\`. The Sites column names each file once, with the distinct actions of its call sites and \`×n\` when it holds several of the row's call sites (\`n\` counts sites, not actions), never a line number.`,
    ],
    generatorPath: "scripts/legal/cookies-and-storage.mjs",
    pagePath: PAGE,
    sources: { [CLASSIFICATION]: sha256Of(classification.text) },
    summary: counts,
    columns: ["App", "Kind", "Name", "Status", "Lifetime", "Attributes", "Note", "Sites"],
    rows: keys.map((key) => {
      const [app = "", kind = "", ...rest] = key.split(":");
      const e = /** @type {Partial<StorageEntry>} */ (entries.get(key) ?? {});
      const sites = byKey.get(key) ?? [];
      const [, file = "", ...arg] = rest;
      const unresolved = `\`${e.resolvesTo ?? "?"}\` (from \`${arg.join(":")}\` in ${file})`;
      const name = UNRESOLVED.test(key) ? unresolved : `\`${rest.join(":")}\``;
      const status = `${e.status ?? "unclassified"}${e.manual ? " (manual)" : ""}`;
      // Sorted, so the column never depends on site order; each literal keeps its own entry
      // order, because a spread placed after an option overrides it.
      const options = [...new Set(sites.map((s) => s.attributes).filter(Boolean))].sort();
      const shown = options.map((option) => `\`{ ${option} }\``).join("; ");
      // A file, not a line: the count and the actions are facts, a line number only a position.
      const where = [...new Set(sites.map((s) => s.file))]
        .sort()
        .map((file) => {
          const here = sites.filter((s) => s.file === file);
          const actions = ACTIONS.filter((action) => here.some((s) => s.action === action));
          return `${file}${here.length > 1 ? ` ×${here.length}` : ""} (${actions.join(", ")})`;
        })
        .join(", ");
      const cells = [e.lifetime ?? "", shown, e.note ?? "", where || "none in the scanned code"];
      return [app, kind, name, status, ...cells];
    }),
  });
  return { pagePath: PAGE, markdown, problems, counts, filesScanned };
}

/** @type {import("./lib/inventory.mjs").Generator} */
export const generator = {
  name: "cookies-and-storage",
  generate: async () => {
    const inventory = await buildInventory();
    const sites = `${inventory.filesScanned ?? 0} files, ${inventory.counts?.sites ?? 0} sites`;
    process.stdout.write(`legal-inventory cookies-and-storage: scanned ${sites}\n`);
    return inventory;
  },
};
