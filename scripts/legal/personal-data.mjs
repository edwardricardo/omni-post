// @ts-check
/**
 * @file personal-data.mjs
 * @description The `personal-data` legal inventory: the fields of `infra/prisma/schema.prisma`
 *   whose name may hold personal data, joined with `docs/legal/classification/personal-data.json`.
 *   A field is a candidate when a whole segment of its name (split on camelCase, digits and `_`)
 *   is a VOCABULARY token: `clientIp` matches, `recipient` does not. The vocabulary prefers recall,
 *   since a false positive costs one `not-personal` entry and a miss an unregistered field; a miss
 *   a reviewer catches is recorded with `"manual": true`. Problems: a candidate with no entry, an
 *   entry whose field is gone or that is neither a candidate nor manual, `manual` on a candidate,
 *   and a pending count other than `pendingBaseline`. Zero models or candidates is a scope error.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadClassification, renderInventory, sha256Of } from "./lib/inventory.mjs";

export const SCHEMA = "infra/prisma/schema.prisma";
export const CLASSIFICATION = "docs/legal/classification/personal-data.json";
export const PAGE = "docs/legal/inventories/personal-data.generated.md";
const CATEGORIES = "identifier contact credential technical content financial behavioural special";
const ALLOWED = Object.freeze({
  statuses: ["personal", "not-personal", "pending"],
  categories: CATEGORIES.split(" "),
  subjects: ["customer-user", "admin-user", "third-party", "organisation"],
});

/** @type {Array<[string, string]>} name segments that may mark personal data, by reason */
const VOCABULARY_GROUPS = [
  ["contact or postal details of a person", "email phone address street city zip postal country"],
  ["a name or handle that identifies a person", "name username handle"],
  ["a person's picture or self-description", "avatar photo picture profile bio"],
  ["a civil identity attribute", "birth dob gender ssn passport tax vat"],
  ["a trace a visit leaves", "ip agent ua device fingerprint referrer location geo lat lng utm"],
  ["a preference a person sets on their own account", "locale timezone"],
  ["a secret that authenticates someone", "credential credentials token tokens secret secrets"],
  ["the stored form of a secret", "ciphertext password mfa signature"],
  ["a reference to the person who acted", "user by actor author submitter reviewer"],
  ["a reference to the person acted upon", "member assignee contact customer"],
  ["text a person wrote, which may describe others", "body"],
  ["a decision a person recorded", "consent"],
  ["an organisation that may be a natural person", "company"],
];
/** @type {ReadonlyMap<string, string>} token → why it is listed */
export const VOCABULARY = new Map(
  VOCABULARY_GROUPS.flatMap(([why, tokens]) => tokens.split(" ").map((t) => [t, why]))
);
const SEGMENT_BREAK = /_|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])/;

/** @typedef {import("./lib/inventory.mjs").Entry} Entry */
/** @typedef {{ model: string, field: string, type: string, optional: boolean, isList: boolean, attributes: string[], doc: string }} Field */
/** @typedef {{ name: string, fields: Field[] }} Model */

/**
 * Reads the `model` blocks of a Prisma schema; `@@` lines and comments are skipped, and the `///`
 * lines directly above a field become its `doc`. A relation is a field like any other.
 * @type {(text: string) => Model[]}
 */
export function parsePrismaSchema(text) {
  /** @type {Model[]} */
  const models = [];
  /** @type {Model | null} */
  let model = null;
  /** @type {string[]} */
  let doc = [];
  for (const line of text.split("\n").map((raw) => raw.trim())) {
    const open = /^model\s+(\w+)\s*\{/.exec(line);
    const code = line.replace(/^((?:[^"/]|"[^"]*"|\/(?!\/))*)\/\/.*$/, "$1").trim();
    const found = /^(\w+)\s+(Unsupported\("[^"]*"\)|\w+)(\[\])?(\?)?\s*(.*)$/.exec(code);
    if (open) models.push((model = { name: String(open[1]), fields: [] }));
    else if (line === "}") model = null;
    else if (model !== null && found !== null) {
      const [, field = "", type = "", list, optional, rest = ""] = found;
      const attributes = rest.split(/\s+(?=@)/).filter(Boolean);
      const shape = { type, optional: optional !== undefined, isList: list !== undefined };
      model.fields.push({ model: model.name, field, ...shape, attributes, doc: doc.join(" ") });
    }
    doc = line.startsWith("///") ? [...doc, line.slice(3).trim()] : [];
  }
  return models;
}

/** @type {(models: Model[], vocabulary?: ReadonlyMap<string, string>) => Field[]} */
export const findCandidates = (models, vocabulary = VOCABULARY) => {
  /** @type {(name: string) => string[]} */
  const segments = (name) => name.split(SEGMENT_BREAK).map((s) => s.toLowerCase());
  return models.flatMap((m) =>
    m.fields.filter((f) => segments(f.field).some((s) => vocabulary.has(s)))
  );
};

/**
 * Joins the candidates with the classification and renders the page under `root`.
 * @type {(options?: { root?: string }) => Promise<import("./lib/inventory.mjs").Inventory & { counts?: Record<string, number> }>}
 */
export async function buildInventory({ root = REPO_ROOT } = {}) {
  const schema = readFileSync(path.join(root, SCHEMA), "utf8");
  const models = parsePrismaSchema(schema);
  const candidates = findCandidates(models);
  const empty = models.length === 0 ? "models" : candidates.length === 0 ? "candidates" : null;
  if (empty !== null) {
    const scopeError = `${SCHEMA} yielded zero ${empty}: a scan that read nothing is not clean`;
    return { pagePath: PAGE, markdown: "", problems: [], scopeError };
  }
  const classification = loadClassification(root, CLASSIFICATION, ALLOWED);
  const { entries, pendingBaseline, problems } = classification;
  const fields = new Map(models.flatMap((m) => m.fields).map((f) => [`${f.model}.${f.field}`, f]));
  const matched = new Set(candidates.map((f) => `${f.model}.${f.field}`));
  const unclassified = [...matched].filter((key) => !entries.has(key));
  problems.push(...unclassified.map((key) => `${key} is a candidate with no entry: classify it`));
  for (const [key, { manual = false }] of entries) {
    const vocabulary = matched.has(key) ? "matches" : "misses";
    if (!fields.has(key)) problems.push(`${key} is classified but no longer in ${SCHEMA}`);
    else if (manual === matched.has(key))
      problems.push(`${key}: manual ${manual}, vocabulary ${vocabulary}`);
  }
  const rows = [...fields.keys()].filter((key) => matched.has(key) || entries.get(key)?.manual);
  const statusOf = (/** @type {string} */ key) => entries.get(key)?.status ?? "unclassified";
  const tally = (/** @type {string} */ status) => rows.filter((k) => statusOf(k) === status).length;
  const [pending, manual] = [tally("pending"), rows.filter((k) => entries.get(k)?.manual).length];
  if (pending > pendingBaseline)
    problems.push(`${pending} pending exceed pendingBaseline ${pendingBaseline}`);
  if (pending < pendingBaseline)
    problems.push(`stale pendingBaseline ${pendingBaseline}: lower it to ${pending}`);
  const totals = ["personal", "not-personal", "pending", "unclassified"].map((s) => [s, tally(s)]);
  const counts = { "models scanned": models.length, candidates: candidates.length };
  Object.assign(counts, { "manual additions": manual }, Object.fromEntries(totals));
  const markdown = await renderInventory({
    title: "Personal data inventory",
    intro: [
      "Every database field whose name may hold personal data, and what the code says it holds: whether it is personal data, its category, and whose data it is.",
      "- **Not the register.** Legal basis, purpose and retention are owned by `docs/legal/REGISTER.md` and the [retention calendar](../../compliance/RETENTION_CALENDAR.md), never by this page.\n" +
        `- **How a field gets here.** A field is a candidate when a segment of its name matches the vocabulary of the generator, and every candidate needs an entry in \`${CLASSIFICATION}\`. A personal field the vocabulary misses is added there with \`"manual": true\`.`,
    ],
    generatorPath: "scripts/legal/personal-data.mjs",
    pagePath: PAGE,
    sources: { [SCHEMA]: sha256Of(schema), [CLASSIFICATION]: sha256Of(classification.text) },
    summary: counts,
    columns: ["Model", "Field", "Type", "Status", "Category", "Subject", "Note"],
    rows: rows.sort().map((key) => {
      const f = /** @type {Field} */ (fields.get(key));
      const e = /** @type {Partial<Entry>} */ (entries.get(key) ?? {});
      const status = `${e.status ?? "unclassified"}${e.manual ? " (manual)" : ""}`;
      const type = `\`${f.type}${f.isList ? "[]" : ""}${f.optional ? "?" : ""}\``;
      const cells = [e.category, e.subject, e.note].map((value) => value ?? "");
      return [f.model, `\`${f.field}\``, type, status, ...cells];
    }),
  });
  return { pagePath: PAGE, markdown, problems, counts };
}

/** @type {import("./lib/inventory.mjs").Generator} */
export const generator = { name: "personal-data", generate: () => buildInventory() };
