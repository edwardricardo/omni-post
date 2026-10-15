// @ts-check
/**
 * @file subprocessors.mjs
 * @description The `subprocessors` legal inventory: every direct dependency the workspace
 *   manifests declare, joined with `CLASSIFICATION` by package name, so that each third-party
 *   service the product sends data to is classified `service` with its vendor, purpose, toggle,
 *   data sent and production path. A service no dependency traces, which the code reaches by
 *   `fetch`, is added with `"manual": true`. The social providers of the `Provider` enum whose
 *   provider package declares no `service` dependency are derived as recipients without a
 *   dependency. The classification's `tooling` list names the private workspaces that only tooling
 *   runs, which no field can mark as such, so their run-time dependencies are not production.
 *   Versions and the lockfile are not read. A missing root, an unreadable manifest, zero manifests
 *   or zero names is a scope error, reported with the classification's own problems. The page
 *   holds no manifest count, so a workspace that declares nothing new never stales it; `generate`
 *   prints that count instead.
 * @layer infrastructure
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadClassification, renderInventory, sha256Of } from "./lib/inventory.mjs";
import { SCHEMA, providerEnum } from "./oauth-scopes.mjs";

export const CLASSIFICATION = "docs/legal/classification/subprocessors.json";
export const PAGE = "docs/legal/inventories/subprocessors.generated.md";
export const ROOTS = Object.freeze(["apps", "packages", "infra"]);
const ROOT_MANIFEST = "package.json";
const SKIPPED = new Set(["node_modules", "dist", ".next"]);
const BLOCKS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const STATUSES = ["service", "library", "pending"];
/** @type {Array<"vendor" | "purpose" | "envToggle" | "dataSent" | "productionPath">} */
const FIELDS = ["vendor", "purpose", "envToggle", "dataSent", "productionPath"];
const HEAD = "Name|Vendor|Purpose|Turned on by|Data sent|Production path|Declared by".split("|");
const PATHS = ["yes", "no", "build-time only"];
const EXTRA_FIELDS = Object.fromEntries(FIELDS.map((field) => [field, false]));
const ALLOWED = { statuses: STATUSES, categories: [], subjects: [], extraFields: EXTRA_FIELDS };
const TOOLING_KEYS = ["workspace", "note"];

/** @typedef {import("./lib/inventory.mjs").Entry & Partial<Record<(typeof FIELDS)[number], string>>} DependencyEntry */
/** @typedef {{ manifests: string[], production: boolean }} Declared */
/** @typedef {{ file: string, data: Record<string, unknown> }} Manifest */
/** @typedef {{ file: string, block: string, name: string, spec: string }} Declaration */
/** @typedef {{ manifests: string[], names: Map<string, Declared>, digest: string, missing: string[], unreadable: string[], listed: string[], problems: string[] }} Scan */
/** @typedef {import("./lib/inventory.mjs").Inventory & { counts?: Record<string, number>, scanned?: string }} Built */

/** @type {(value: unknown) => value is Record<string, unknown>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @type {(file: string) => unknown} the file parsed as JSON, or null when it is no JSON */
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** @type {(root: string, dir: string) => string[]} every `package.json` under `dir`, pruning `SKIPPED` */
function manifestsUnder(root, dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((item) => {
    const child = `${dir}/${item.name}`;
    if (item.isDirectory()) return SKIPPED.has(item.name) ? [] : manifestsUnder(root, child);
    return item.name === "package.json" ? [child] : [];
  });
}

/**
 * Reads the classification's `tooling` list, `[{ "workspace": "<name>", "note": "<why>" }]`. An
 * entry holds a workspace name and a note, and nothing else, and a name is listed once. A refused
 * entry is not applied, and each refusal is a problem; a text that is no JSON yields neither, since
 * `loadClassification` already reports it.
 * @type {(text: string) => { listed: string[], problems: string[] }}
 */
function readToolingList(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { listed: [], problems: [] };
  }
  const list = isObject(data) ? data.tooling : undefined;
  if (!Array.isArray(list))
    return { listed: [], problems: [`${CLASSIFICATION} holds no tooling array`] };
  /** @type {string[]} */
  const listed = [];
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  list.forEach((entry, index) => {
    const fields = isObject(entry) ? entry : /** @type {Record<string, unknown>} */ ({});
    const { workspace, note } = fields;
    const named = typeof workspace === "string" && workspace !== "" ? workspace : undefined;
    const label = named ?? `entry ${index}`;
    const unknown = Object.keys(fields).filter((key) => !TOOLING_KEYS.includes(key));
    const refusals = /** @type {Array<[boolean, string]>} */ ([
      [!isObject(entry), "is not an object"],
      [unknown.length > 0, `has unknown keys ${unknown.join(", ")}`],
      [named === undefined, "has no workspace"],
      [typeof note !== "string" || note === "", "has no note"],
      [named !== undefined && seen.has(named), "is listed twice"],
    ]).flatMap(([refused, why]) => (refused ? [`${CLASSIFICATION}: tooling ${label} ${why}`] : []));
    if (named !== undefined) seen.add(named);
    problems.push(...refusals);
    if (refusals.length === 0) listed.push(label);
  });
  return { listed, problems };
}

/**
 * The tooling manifests: the `seeds`, and every workspace whose every declaration is a
 * `devDependencies` one or is made by a tooling manifest. What tooling declares is never
 * production, so a workspace only tooling needs is tooling too. Iterated to its fixed point; each
 * round can only grow the set, so it ends within one round per manifest.
 * @type {(read: Manifest[], declarations: Declaration[], seeds: Set<string>) => Set<string>}
 */
function toolingOf(read, declarations, seeds) {
  let tooling = new Set(seeds);
  for (;;) {
    const next = new Set(seeds);
    for (const { file, data } of read) {
      const declaring = declarations.filter((d) => d.name === data.name);
      const dev = declaring.every((d) => d.block === "devDependencies" || tooling.has(d.file));
      if (declaring.length > 0 && dev) next.add(file);
    }
    if (next.size === tooling.size) return next;
    tooling = next;
  }
}

/**
 * Reads the root manifest and every manifest under `ROOTS`, and returns each declared name that
 * is not a workspace package, with the manifests declaring it. A name is production when a block
 * other than `devDependencies` declares it in a manifest that is not tooling; tooling is the root
 * manifest, every workspace `listed` names, and every workspace whose every declaration is a
 * `devDependencies` one or is made by a tooling manifest. A listed name is refused, with a problem,
 * when no workspace carries it, when its workspace is not `private: true`, or when a manifest that
 * is not tooling declares it outside `devDependencies`: such a workspace reaches production.
 * @type {(root: string, listed?: string[]) => Scan}
 */
export function scanManifests(root, listed = []) {
  const missing = [ROOT_MANIFEST, ...ROOTS].filter((dir) => !existsSync(path.join(root, dir)));
  const under = missing.length > 0 ? [] : ROOTS.flatMap((dir) => manifestsUnder(root, dir)).sort();
  const files = missing.length > 0 ? [] : [ROOT_MANIFEST, ...under];
  const parsed = files.map((file) => ({ file, data: readJson(path.join(root, file)) }));
  const unreadable = parsed.filter(({ data }) => !isObject(data)).map(({ file }) => file);
  /** @type {Manifest[]} */
  const read = parsed.flatMap(({ file, data }) => (isObject(data) ? [{ file, data }] : []));
  const workspaces = new Set(read.map(({ data }) => data.name));
  /** @type {Declaration[]} */
  const declarations = read.flatMap(({ file, data }) =>
    BLOCKS.flatMap((block) => {
      const list = Object.entries(isObject(data[block]) ? data[block] : {});
      return list.map(([name, spec]) => ({ file, block, name, spec: String(spec) }));
    })
  );
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} each applied listed name with its manifest */
  const seeds = new Map();
  for (const name of listed) {
    const manifest = read.find((m) => m.file !== ROOT_MANIFEST && m.data.name === name);
    const refuse = (/** @type {string} */ why) =>
      problems.push(`${CLASSIFICATION}: tooling ${name} ${why}`);
    if (manifest === undefined) refuse("is not a workspace package");
    else if (manifest.data.private !== true) refuse("is not private: true");
    else seeds.set(name, manifest.file);
  }
  const toolingNow = () =>
    toolingOf(read, declarations, new Set([ROOT_MANIFEST, ...seeds.values()]));
  /**
   * Each seed that a manifest which is not tooling declares outside `devDependencies`, with those
   * declarations.
   * @type {(tooling: Set<string>) => Array<[string, string[]]>}
   */
  const declaredByProduction = (tooling) =>
    [...seeds.keys()].flatMap((name) => {
      const by = declarations
        .filter((d) => d.name === name && d.block !== "devDependencies" && !tooling.has(d.file))
        .map((d) => `${d.file} (${d.block})`);
      return by.length > 0 ? [/** @type {[string, string[]]} */ ([name, by])] : [];
    });
  // Dropping a refused seed can leave another seed declared by a manifest that is no longer
  // tooling, so the check repeats until no seed is refused.
  let tooling = toolingNow();
  let refused = declaredByProduction(tooling);
  while (refused.length > 0) {
    for (const [name, by] of refused) {
      const where = by.join(", ");
      problems.push(
        `${CLASSIFICATION}: tooling ${name} is declared outside devDependencies by a manifest that is not tooling: ${where}`
      );
      seeds.delete(name);
    }
    tooling = toolingNow();
    refused = declaredByProduction(tooling);
  }
  /** @type {Map<string, Declared>} */
  const names = new Map();
  for (const { file, block, name, spec } of declarations) {
    if (workspaces.has(name) || spec.startsWith("workspace:")) continue;
    const seen = names.get(name) ?? { manifests: [], production: false };
    if (!seen.manifests.includes(file)) seen.manifests.push(file);
    seen.production ||= block !== "devDependencies" && !tooling.has(file);
    names.set(name, seen);
  }
  const sorted = new Map([...names].sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1)));
  const facts = [...sorted].map(([name, d]) => `${name} ${d.production} ${d.manifests.join(" ")}`);
  const digest = sha256Of(facts.join("\n"));
  const applied = [...seeds.keys()];
  return {
    manifests: files,
    names: sorted,
    digest,
    missing,
    unreadable,
    listed: applied,
    problems,
  };
}

/** @type {(head: string[], body: string[][]) => string} a Markdown table, or "None." with no rows */
const table = (head, body) =>
  body.length === 0
    ? "None."
    : [head, head.map(() => "---"), ...body]
        .map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`)
        .join("\n");

/** @type {(options?: { root?: string }) => Promise<Built>} reads the manifests under `root` and renders the page */
export async function buildInventory({ root = REPO_ROOT } = {}) {
  const classification = loadClassification(root, CLASSIFICATION, ALLOWED);
  const { pendingBaseline, problems } = classification;
  const entries = /** @type {Map<string, DependencyEntry>} */ (classification.entries);
  const toolingList = readToolingList(classification.text);
  const scan = scanManifests(root, toolingList.listed);
  problems.push(...toolingList.problems, ...scan.problems);
  const { names } = scan;
  const schema = path.join(root, SCHEMA);
  const providers = existsSync(schema) ? providerEnum(readFileSync(schema, "utf8")) : [];
  const scope = /** @type {Array<[boolean, string]>} */ ([
    [scan.missing.length === 0, `${scan.missing.join(", ")} does not exist`],
    [scan.unreadable.length === 0, `${scan.unreadable.join(", ")} is not a JSON object`],
    [scan.manifests.length > 1, `${ROOTS.join(", ")} yielded zero manifests`],
    [names.size > 0, "the manifests yielded zero dependency names"],
    [existsSync(schema), `${SCHEMA} does not exist`],
    [providers.length > 0, `${SCHEMA} yielded zero Provider enum values`],
  ]).find(([whole]) => !whole)?.[1];
  if (scope !== undefined) {
    const scopeError = `${scope}: a scan that cannot read its whole scope is not clean`;
    return { pagePath: PAGE, markdown: "", problems, scopeError };
  }
  for (const name of names.keys())
    if (!entries.has(name)) problems.push(`${name} is a candidate with no entry: classify it`);
  for (const [name, entry] of entries) {
    const service = entry.status === "service";
    if (entry.manual && (names.has(name) || !service))
      problems.push(`${name}: manual, but ${service ? "a manifest declares it" : "not a service"}`);
    if (!entry.manual && !names.has(name))
      problems.push(`${name} is classified but no manifest declares it`);
    for (const field of FIELDS) {
      if (service && entry[field] === undefined)
        problems.push(`${name} is a service with no ${field}`);
      if (!service && entry[field] !== undefined)
        problems.push(`${name}: ${field} belongs on a service, and only there`);
    }
    const { productionPath = "yes" } = entry;
    if (service && !PATHS.includes(productionPath))
      problems.push(`${name} has productionPath "${productionPath}", not ${PATHS.join("|")}`);
  }
  const manual = [...entries].filter(([name, e]) => e.manual && !names.has(name)).map(([n]) => n);
  const keys = [...names.keys(), ...manual];
  const statusOf = (/** @type {string} */ key) => entries.get(key)?.status ?? "unclassified";
  const tally = (/** @type {string} */ status) => keys.filter((k) => statusOf(k) === status).length;
  const pending = tally("pending");
  if (pending > pendingBaseline)
    problems.push(`${pending} pending exceed pendingBaseline ${pendingBaseline}`);
  if (pending < pendingBaseline)
    problems.push(`stale pendingBaseline ${pendingBaseline}: lower it to ${pending}`);
  const services = keys.filter((key) => statusOf(key) === "service");
  const traced = (/** @type {string} */ provider) =>
    services.some((key) =>
      names.get(key)?.manifests.includes(`packages/providers/${provider}/package.json`)
    );
  const without = providers.filter((provider) => !traced(provider));
  const counts = {
    "services traced by a dependency": services.filter((key) => names.has(key)).length,
    "services without a dependency (manual)": services.filter((key) => !names.has(key)).length,
    libraries: tally("library"),
    pending,
    unclassified: tally("unclassified"),
    "dev-only services": services.filter((key) => names.get(key)?.production === false).length,
    "providers without a dependency": without.length,
  };
  const entryOf = (/** @type {string} */ key) =>
    /** @type {DependencyEntry} */ (entries.get(key) ?? {});
  const nameCell = (/** @type {string} */ key) => `\`${key}\`${names.has(key) ? "" : " (manual)"}`;
  const declaredBy = (/** @type {string} */ key) =>
    names.get(key)?.manifests.join(", ") ?? "none: reached by `fetch`";
  const serviceRows = services.map((key) => {
    const e = entryOf(key);
    const cells = FIELDS.map((field) => e[field] ?? "");
    return [nameCell(key), ...cells, declaredBy(key)];
  });
  const pendingLines = keys.filter((key) => statusOf(key) === "pending");
  const listedCell = scan.listed.map((name) => `\`${name}\``).join(", ") || "none";
  const markdown = await renderInventory({
    title: "Subprocessors inventory",
    intro: [
      "Every third-party service the product sends data to, as its dependencies declare it: who receives what, for which feature, and what turns it on. A `library` dependency reaches no third-party endpoint of its own and is counted, not listed; the classification file lists it.",
      "## Subprocessors",
      table(HEAD, serviceRows),
      "## Recipients without a dependency",
      "Social providers of the `Provider` enum whose provider package declares no `service` dependency: the product reaches them by `fetch`, so no row above names them. Their OAuth permissions are in the [OAuth scopes inventory](oauth-scopes.generated.md).",
      without.map((provider) => `- \`${provider}\``).join("\n") || "None.",
      "## Pending",
      pendingLines.map((key) => `- \`${key}\`: ${entryOf(key).note}`).join("\n") || "None.",
      "## About this page",
      "- **Not the register.** Legal basis, transfers and retention are owned by `docs/legal/REGISTER.md`, never by this page.\n" +
        `- **What is scanned.** The root \`package.json\` and every \`package.json\` under \`${ROOTS.join("`, `")}\`, skipping \`node_modules\`, \`dist\` and \`.next\`. A candidate is a name in a \`dependencies\`, \`devDependencies\`, \`optionalDependencies\` or \`peerDependencies\` block that is no workspace package and has no \`workspace:\` specifier; a \`catalog:\` specifier still names its package. The \`**/package.json\` hash covers the scan's result: each name, whether it is production and the manifests that declare it.\n` +
        "- **Not the lockfile.** Versions are not read, and the lockfile is not parsed: a direct dependency is what a manifest declares, and versions and transitive packages are not legally relevant facts of a recipient. This departs from the plan, which named the lockfile as a source.\n" +
        `- **How a row gets here.** Each candidate is keyed by its package name as declared, scoped names included, and needs an entry in \`${CLASSIFICATION}\`: \`service\` (the package talks to a third-party service that may receive personal data, or ships the product's telemetry to one), \`library\` (no third-party endpoint of its own) or \`pending\`. A service states its vendor, purpose, what turns it on, the data it sends and its production path (\`yes\`, \`no\` or \`build-time only\`). A service the code reaches by \`fetch\`, which no dependency traces, is added with \`"manual": true\`.\n` +
        "- **Production or dev-only.** A name is production when a block other than `devDependencies` declares it in a manifest that is not tooling. " +
        `Tooling is the root manifest, each workspace the \`tooling\` list of \`${CLASSIFICATION}\` names (${listedCell}), and every workspace whose every declaration is a \`devDependencies\` one or is made by a tooling manifest. ` +
        "A listed workspace is `private: true`, no manifest that is not tooling declares it outside `devDependencies`, and its entry says why it never reaches production; the check refuses any other.",
    ],
    generatorPath: "scripts/legal/subprocessors.mjs",
    pagePath: PAGE,
    sources: { "**/package.json": scan.digest, [CLASSIFICATION]: sha256Of(classification.text) },
    summary: counts,
    columns: ["Name", "Status", "Scope", "Declared by", "Note"],
    rows: keys
      .filter((key) => statusOf(key) !== "library")
      .map((key) => {
        const declared = names.get(key);
        const scopeCell =
          declared === undefined ? "" : declared.production ? "production" : "dev-only";
        return [nameCell(key), statusOf(key), scopeCell, declaredBy(key), entryOf(key).note ?? ""];
      }),
  });
  const workspaces = Math.max(scan.manifests.length - 1, 0);
  const scanned = `${scan.manifests.length} manifests in ${workspaces} workspaces, ${names.size} names`;
  return { pagePath: PAGE, markdown, problems, counts, scanned };
}

/**
 * Prints the scan size only for a scan that read its scope; a scope error speaks for itself.
 * @type {import("./lib/inventory.mjs").Generator}
 */
export const generator = {
  name: "subprocessors",
  generate: async (/** @type {{ root?: string }} */ options = {}) => {
    const inventory = await buildInventory(options);
    if (inventory.scopeError === undefined)
      process.stdout.write(`legal-inventory subprocessors: scanned ${inventory.scanned}\n`);
    return inventory;
  },
};
