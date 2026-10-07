// @ts-check
/**
 * @file oauth-scopes.mjs
 * @description The `oauth-scopes` legal inventory: every OAuth scope the product requests or
 *   declares per connected provider, joined with `CLASSIFICATION` as `<provider>:<scope>` in its
 *   source's spelling. Social providers are the `Provider` enum of `SCHEMA`, read from `login`
 *   (the connect flow's `scopes` in `LOGIN`), `adapter` (each adapter's `requiredScopes`) and
 *   `shared` (`requiredScopes` in `SHARED`); each CRM is read from its authorize route in
 *   `CRM_ROUTES` as `crm`. An entry whose `sources` differ from the scan is a problem, so a new or
 *   healed mismatch is acknowledged. A missing source, a record not declared exactly once, a CRM
 *   route with no scope literal of its own, a CRM listed twice, a provider name holding `:` (all
 *   names are checked before any source is read) or a reader that finds nothing is a scope error,
 *   which carries the problems found before it. The page hashes the scan result, not the source
 *   files, so an edit that changes no scope, source or provider leaves it current.
 * @layer infrastructure
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadClassification, renderInventory, sha256Of } from "./lib/inventory.mjs";
import * as scan from "./lib/source-scan.mjs";

export const SCHEMA = "infra/prisma/schema.prisma";
export const LOGIN = "apps/api/src/auth/providerOAuthConfigs.ts";
export const SHARED = "packages/shared/src/providers/providerConfig.ts";
export const CRM_ROUTES = "apps/api/src/crm/crmRoutes.ts";
export const CLASSIFICATION = "docs/legal/classification/oauth-scopes.json";
export const PAGE = "docs/legal/inventories/oauth-scopes.generated.md";
const ADAPTERS = "packages/providers";
const ADAPTER_FILE = /^packages\/providers\/([^/]+)\/src\/[^/]+Adapter\.ts$/;
const SOURCES = Object.freeze(["login", "adapter", "shared", "crm"]);
const SOCIAL = SOURCES.slice(0, 3);
const STATUSES = ["required", "optional", "unused", "pending"];
const FIELDS = { extraFields: { grants: true }, listFields: { sources: SOURCES } };
const ALLOWED = Object.freeze({ statuses: STATUSES, categories: [], subjects: [], ...FIELDS });
/** @typedef {[string, RegExp, RegExp]} Crm a CRM's name, its scope literal in its authorize route, the separator */
/** @type {Crm[]} */
const CRMS = [
  ["hubspot", /\bscopes\s*=\s*"([^"]+)"/, /\s+/],
  ["salesforce", /[?&]scope=([\w.:+-]+)/, /\+/],
];
/** The name the page gives the hash of the scan result. */
const SCAN_RESULT = "the oauth-scopes scan result";
/** A Fastify route registration; the next one ends the block of the route before it. */
const REGISTRATION = String.raw`\bapp\.(?:get|post|put|patch|delete|head|options|all|route)\(`;
const ROUTE_START = new RegExp(REGISTRATION);
const NOT_SCANNED = [
  "`apps/client/lib/utils/providerMapper.ts` (`getDefaultScopes`): client display metadata whose names, such as `read`, `write` and `r_liteprofile`, are not the providers' scope strings.",
  "`packages/providers/tiktok/src/apiClient.ts` (the `scopes` of its auth service): the TikTok package's internal authorization service, which no connect flow of `apps/api` calls.",
  "`getAuthorizationUrl` of `packages/adapters/crm-hubspot/src/HubSpotAdapter.ts` and `packages/adapters/crm-salesforce/src/SalesforceAdapter.ts`: a second authorization URL per CRM that the authorize routes do not call; HubSpot's adds `crm.objects.companies.read`.",
];

/** @typedef {import("./lib/inventory.mjs").Entry & { sources?: string[], grants?: string }} ScopeEntry */
/** @typedef {{ values: string[], unread: string[] }} Scopes */
/** @typedef {import("./lib/inventory.mjs").Inventory & { counts?: Record<string, number> }} Built */

/** @type {(scope: string, problems?: string[]) => Built} carries the problems found before the error */
const failClosed = (scope, problems = []) => {
  const scopeError = `${scope}: a scan that cannot read its whole scope is not clean`;
  return { pagePath: PAGE, markdown: "", problems, scopeError };
};

/** @type {(schema: string) => string[]} the `Provider` enum values, lower-cased as the code keys them */
export const providerEnum = (schema) =>
  (/^enum Provider \{([^}]*)\}/m.exec(schema)?.[1] ?? "")
    .split("\n")
    .map(
      (line) =>
        line
          .replace(/\/\/.*$/, "")
          .trim()
          .split(/\s+/)[0] ?? ""
    )
    .filter((value) => value !== "" && !value.startsWith("@@"))
    .map((value) => value.toLowerCase());

/**
 * The top-level `key: value` entries of the object literal a `const` named `name` holds in `code`,
 * or `null` unless `code` declares that `const` exactly once, so a second declaration is never
 * silently ignored.
 * @type {(code: string, name: string) => Array<[string, string]> | null}
 */
export function recordEntries(code, name) {
  const escaped = name.replace(/[$.*+?^()[\]{}|\\]/g, "\\$&");
  const declared = new RegExp(String.raw`\bconst\s+${escaped}(?![\w$])[^=;]*=\s*\{`, "g");
  const [start, ...others] = [...code.matchAll(declared)];
  if (start === undefined || others.length > 0) return null;
  const entries = scan.splitArguments(code, (start.index ?? 0) + start[0].length);
  return entries.flatMap((entry) => {
    const keyed = /^([A-Za-z_$][\w$]*)\s*:\s*/.exec(entry);
    return keyed === null ? [] : [[keyed[1] ?? "", entry.slice(keyed[0].length)]];
  });
}

/**
 * The string elements of every `<property>: [...]` in `code`; an element, or a value that is no
 * array literal, which is no string its file states lands in `unread`.
 * @type {(text: string, code: string, property: string) => Scopes}
 */
export function scopesIn(text, code, property) {
  /** @type {Scopes} */
  const found = { values: [], unread: [] };
  const declared = new RegExp(String.raw`(?<![\w$.])${property}\s*:\s*(\[?)`, "g");
  for (const match of code.matchAll(declared)) {
    const items = scan.splitArguments(code, (match.index ?? 0) + match[0].length);
    for (const item of match[1] === "[" ? items : items.slice(0, 1)) {
      const value = match[1] === "[" ? scan.resolveStringArgument(text, item) : null;
      (value === null ? found.unread : found.values).push(value ?? item);
    }
  }
  return found;
}

/**
 * The source of the route registered with the path `route`: from its `app.<verb>(` registration
 * up to the next registration, or to the end of the file for the last route; `null` when no route
 * is registered with that path. The same path quoted elsewhere, such as a redirect URL, is no route.
 * @type {(code: string, route: string) => string | null}
 */
export function routeBlock(code, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const registered = new RegExp(String.raw`${REGISTRATION}\s*"${escaped}"`).exec(code);
  if (registered === null) return null;
  const from = registered.index + registered[0].length;
  const next = code.slice(from).search(ROUTE_START);
  return code.slice(registered.index, next === -1 ? code.length : from + next);
}

/** @type {(options?: { root?: string, crms?: Crm[] }) => Promise<Built>} reads the sources under `root` and renders the page */
export async function buildInventory({ root = REPO_ROOT, crms = CRMS } = {}) {
  const roots = [LOGIN, SHARED, CRM_ROUTES, ADAPTERS];
  const { files, missing } = scan.listSourceFiles(root, { roots });
  if (!existsSync(path.join(root, SCHEMA))) missing.push(SCHEMA);
  if (missing.length > 0) return failClosed(`${missing.join(", ")} does not exist`);
  const read = (/** @type {string} */ file) => readFileSync(path.join(root, file), "utf8");
  const adapterFiles = files.filter((file) => ADAPTER_FILE.test(file));
  const providers = providerEnum(read(SCHEMA));
  // Provider names are checked before any source is read: a key splits on its first colon, so a
  // name holding one, or a CRM listed twice, would corrupt every key collected after it.
  const crmNames = crms.map(([name]) => name);
  const everyone = [...providers, ...crmNames];
  const colons = everyone.filter((name) => name.includes(":"));
  const twice = crmNames.filter((name, at) => crmNames.indexOf(name) !== at);
  const unnamed = [
    [providers.length, `${SCHEMA} yielded zero Provider enum values`],
    [colons.length === 0, `provider ${colons.join(", ")} holds ":", the key's separator`],
    [twice.length === 0, `CRM ${twice.join(", ")} is listed more than once`],
  ].find(([count]) => !count);
  if (unnamed !== undefined) return failClosed(String(unnamed[1]));
  const found = /** @type {Map<string, Set<string>>} */ (new Map());
  const problems = /** @type {string[]} */ ([]);
  /** @type {(source: string, owner: string, provider: string, scopes: Scopes) => void} */
  const add = (source, owner, provider, { values, unread }) => {
    if (!providers.includes(provider)) {
      problems.push(
        `${owner}: ${provider} is no Provider value, so none of its scopes is collected`
      );
      return;
    }
    unread.forEach((item) => problems.push(`${owner}: ${item} is no string literal`));
    for (const key of values.map((scope) => `${provider}:${scope}`))
      found.set(key, (found.get(key) ?? new Set()).add(source));
  };
  /** @type {Array<[string, string, string, string]>} */
  const records = [
    [LOGIN, "login", "oauthProviders", "scopes"],
    [SHARED, "shared", "PROVIDER_CONFIGS", "requiredScopes"],
  ];
  for (const [file, source, name, property] of records) {
    const text = read(file);
    const record = recordEntries(scan.blankComments(text), name);
    const once = `${file} does not declare const ${name} exactly once`;
    if (record === null) return failClosed(once, problems);
    for (const [provider, value] of record)
      add(source, `${file} ${provider}`, provider, scopesIn(text, value, property));
  }
  for (const file of adapterFiles) {
    const [text, provider] = [read(file), ADAPTER_FILE.exec(file)?.[1] ?? ""];
    add("adapter", file, provider, scopesIn(text, scan.blankComments(text), "requiredScopes"));
  }
  const crmCode = scan.blankComments(read(CRM_ROUTES));
  const crmGaps = crms.flatMap(([name, pattern, separator]) => {
    const route = `/crm/${name}/authorize`;
    const block = routeBlock(crmCode, route);
    const literal = block === null ? undefined : pattern.exec(block)?.[1];
    literal?.split(separator).forEach((scope) => found.set(`${name}:${scope}`, new Set(["crm"])));
    if (block === null) return [`it has no ${route} route`];
    return literal === undefined ? [`its ${route} route holds no scope literal`] : [];
  });
  const kindOf = (/** @type {string} */ key) =>
    crms.some(([name]) => key.startsWith(`${name}:`)) ? "crm" : "social";
  const social = [...found.keys()].filter((key) => kindOf(key) === "social");
  const empty = [
    [adapterFiles.length, `${ADAPTERS} yielded zero adapter files`],
    [social.length, "the social sources yielded zero scopes"],
    [crmGaps.length === 0, `${CRM_ROUTES}: ${crmGaps.join("; ")}`],
  ].find(([count]) => !count);
  if (empty !== undefined) return failClosed(String(empty[1]), problems);
  const classification = loadClassification(root, CLASSIFICATION, ALLOWED);
  const { pendingBaseline } = classification;
  const entries = /** @type {Map<string, ScopeEntry>} */ (classification.entries);
  problems.push(...classification.problems);
  const ordered = (/** @type {Iterable<string>} */ list) =>
    SOURCES.filter((source) => [...list].includes(source)).join(", ");
  for (const key of found.keys())
    if (!entries.has(key)) problems.push(`${key} is a candidate with no entry: classify it`);
  for (const [key, { sources }] of entries) {
    const scanned = found.get(key);
    if (scanned === undefined) problems.push(`${key} is classified but no source declares it`);
    else if (Array.isArray(sources) && ordered(sources) !== ordered(scanned))
      problems.push(`${key} declares ${ordered(sources)}, the scan finds ${ordered(scanned)}`);
  }
  const rank = (/** @type {string} */ key) => `${kindOf(key) === "social" ? 0 : 1}${key}`;
  const keys = [...found.keys()].sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
  const statusOf = (/** @type {string} */ key) => entries.get(key)?.status ?? "unclassified";
  const tally = (/** @type {string} */ status) => keys.filter((k) => statusOf(k) === status).length;
  const pending = tally("pending");
  if (pending > pendingBaseline)
    problems.push(`${pending} pending exceed pendingBaseline ${pendingBaseline}`);
  if (pending < pendingBaseline)
    problems.push(`stale pendingBaseline ${pendingBaseline}: lower it to ${pending}`);
  // A key splits on its first colon: no provider name holds one (refused above), while a scope
  // may (`boards:read`, Google's scope URLs).
  const providerOf = (/** @type {string} */ key) => key.slice(0, key.indexOf(":"));
  const scopeOf = (/** @type {string} */ key) => key.slice(key.indexOf(":") + 1);
  const sourcesOf = (/** @type {string} */ key) => found.get(key) ?? new Set();
  const mismatches = social.filter((key) => sourcesOf(key).size < SOCIAL.length).sort();
  const without = everyone.filter((name) => !keys.some((key) => providerOf(key) === name));
  const withSource = (/** @type {string} */ source) =>
    new Set(keys.filter((key) => sourcesOf(key).has(source)).map(providerOf)).size;
  const counts = {
    "social providers": providers.length,
    "CRM providers": crms.length,
    ...Object.fromEntries(SOCIAL.map((source) => [`with ${source} scopes`, withSource(source)])),
    "providers without scopes": without.length,
    scopes: keys.length,
    mismatches: mismatches.length,
    ...Object.fromEntries([...STATUSES, "unclassified"].map((status) => [status, tally(status)])),
  };
  const mismatchLines = mismatches.map((key) => {
    const absent = SOCIAL.filter((source) => !sourcesOf(key).has(source)).join(", ");
    return `- **${providerOf(key)}** \`${scopeOf(key)}\`: declared by ${ordered(sourcesOf(key))}; missing from ${absent}.`;
  });
  const scanned = keys.map((key) => `${key}:${ordered(sourcesOf(key))}`).sort();
  const scanResult = [...scanned, `without:${without.join(",")}`].join("\n");
  const markdown = await renderInventory({
    title: "OAuth scopes inventory",
    intro: [
      "Every OAuth scope the product requests or declares for a connected provider, what it lets the product do, and whether a shipped feature needs it. A scope is a data-access grant: what the product can read or publish on the user's behalf.",
      "## Mismatches",
      "A social scope that one of the three sources does not declare. The connect flow (`login`) is what the user grants; the adapter (`adapter`) and the shared metadata (`shared`) say what the product needs and what it shows the user.",
      mismatchLines.join("\n") || "None.",
      "## Providers without scopes",
      without.map((name) => `- \`${name}\` (${kindOf(`${name}:`)})`).join("\n") || "None.",
      "## Declared elsewhere, not scanned",
      NOT_SCANNED.map((line) => `- ${line}`).join("\n"),
      "## About this page",
      "- **Not the register.** Legal basis, consent and retention are owned by `docs/legal/REGISTER.md`, never by this page.\n" +
        `- **What is scanned.** \`login\` is the \`scopes\` of each \`oauthProviders\` entry in \`${LOGIN}\`; \`adapter\` is \`requiredScopes\` in \`${ADAPTERS}/*/src/*Adapter.ts\`; \`shared\` is the \`requiredScopes\` of \`PROVIDER_CONFIGS\` in \`${SHARED}\`; \`crm\` is the scope literal of each authorize route in \`${CRM_ROUTES}\`. The providers are the \`Provider\` enum of \`${SCHEMA}\` and the two CRMs.\n` +
        `- **What the hash covers.** The hash of \`${SCAN_RESULT}\` covers the sorted \`<provider>:<scope>:<sources>\` lines and the providers without scopes, not the source files, so the scan hash changes only when a scope, a source or a provider changes; the regenerating commit is the provenance.\n` +
        `- **How a row gets here.** Each scope becomes \`<provider>:<scope>\`, spelled as its source writes it, and every one needs an entry in \`${CLASSIFICATION}\` whose \`sources\` equal the scan, so a new or healed mismatch must be acknowledged there.`,
    ],
    generatorPath: "scripts/legal/oauth-scopes.mjs",
    pagePath: PAGE,
    sources: {
      [SCAN_RESULT]: sha256Of(scanResult),
      [CLASSIFICATION]: sha256Of(classification.text),
    },
    summary: counts,
    columns: ["Kind", "Provider", "Scope", "Sources", "Status", "Grants", "Note"],
    rows: keys.map((key) => {
      const e = /** @type {Partial<ScopeEntry>} */ (entries.get(key) ?? {});
      const cells = [ordered(sourcesOf(key)), statusOf(key), e.grants ?? "", e.note ?? ""];
      return [kindOf(key), providerOf(key), `\`${scopeOf(key)}\``, ...cells];
    }),
  });
  return { pagePath: PAGE, markdown, problems, counts };
}

/** @type {import("./lib/inventory.mjs").Generator} */
export const generator = { name: "oauth-scopes", generate: () => buildInventory() };
