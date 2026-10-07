// @ts-check
/**
 * @file non-features.mjs
 * @description The support coverage map: every capability candidate the tree yields (route
 *   modules, `packages/core` packages, workers, queues, Admin and client sections), joined by
 *   `<kind>:<name>` with `docs/support/classification/non-features.json` and rendered as
 *   `docs/support/NON_FEATURES.md`. A candidate is `documented` by the support doc it names, a
 *   `non-feature` with the reason support needs no page for it, or `pending`, ratcheted by
 *   `pendingBaseline`. A missing root or a source that yields no candidate is a scope error. The
 *   page holds no count per source; `generate` prints those. Classification loading, rendering,
 *   hashing and the source scan come from the inventory library under `scripts/legal/lib/`, which
 *   the legal and support generators share: it is not legal-only.
 * @layer infrastructure
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  loadClassification,
  renderInventory,
  sha256Of,
} from "../legal/lib/inventory.mjs";
import { blankComments, listSourceFiles } from "../legal/lib/source-scan.mjs";
import { COMMANDS, DIR, listDocs } from "./index.mjs";

export const CLASSIFICATION = `${DIR}/classification/non-features.json`;
export const PAGE = `${DIR}/NON_FEATURES.md`;
const STATUSES = ["documented", "non-feature", "pending"];
const optionalNote = ["documented", "pending"];
// `false` makes `doc` not required by `loadClassification`: a known key, non-empty when present.
// This module requires it on a `documented` entry and refuses it on an entry of any other status.
const extraFields = { doc: false };
const ALLOWED = { statuses: STATUSES, categories: [], subjects: [], extraFields, optionalNote };
/**
 * A route module is named `*Routes.ts` or `routes.ts`, or registers a route with a path literal,
 * `.get("/x"`, across lines and a type argument. Any receiver counts, so a map read keyed by a `/`
 * string would be a candidate to classify: a false candidate is refused until classified, while a
 * receiver allowlist would drop a route unseen.
 */
const [ROUTE_NAME, ROUTE] = [
  /(?:\/routes|Routes)\.ts$/,
  /\.(?:get|post|put|patch|delete|head|options|all)\s*(?:<[^()]*?>)?\(\s*["'`]\//,
];
const [API, CORE, WORKERS] = ["apps/api/src", "packages/core", "apps/workers/src"];
const QUEUES = "packages/adapters/queue-bullmq/src/constants.ts";
const [ADMIN, CLIENT] = ["apps/admin/app/[locale]", "apps/client/app/[locale]"];
/** The client app's business segment, a URL segment that holds the sections like a route group. */
const CLIENT_DASHBOARD = "dashboard";
const ABOUT = [
  "- **What a candidate is.** A file under `apps/api/src` named `*Routes.ts` or `routes.ts`, or one that registers a route with a path literal, comments ignored; a directory of `packages/core` that holds a `package.json`; a `*Worker.ts` or `*Handler.ts` file directly under `apps/workers/src`; a value of `QUEUE_NAMES` in `packages/adapters/queue-bullmq/src/constants.ts`; and a first route segment of the Admin and client apps under `app/[locale]`, where a route group and the client's `dashboard` segment open into their children.",
  "- **How it is classified.** Each candidate has an entry in `docs/support/classification/non-features.json`: `documented` with the `doc` whose page describes it, `non-feature` with a note giving the reason, or `pending` until its page is written. `pendingBaseline` must equal the pending count, so it falls with every page written and a new candidate cannot land unclassified.",
  "- **What is no candidate.** A middleware, a shared library or a page at an app root, such as a dashboard home: a support page that describes one names it in its `paths`.",
];

/** @typedef {import("../legal/lib/inventory.mjs").Entry & { doc?: string }} Classified */
/** @typedef {import("../legal/lib/inventory.mjs").Inventory & { counts?: Record<string, number> }} Built */

/** @type {(root: string, dir: string) => string[]} the directories directly under `dir` */
const dirsOf = (root, dir) =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? [e.name] : []
  );

/** @type {(root: string, dir: string) => string[]} first route segments; a group or `dashboard` opens */
const sectionsOf = (root, dir) =>
  dirsOf(root, dir).flatMap((name) =>
    /^\(.+\)$/.test(name) || name === CLIENT_DASHBOARD ? sectionsOf(root, `${dir}/${name}`) : [name]
  );

/**
 * The candidate names of each kind, read from the tree; every root must exist.
 * @type {(root: string) => Record<string, string[]>}
 */
export function deriveCandidates(root) {
  const read = (/** @type {string} */ file) =>
    blankComments(readFileSync(path.join(root, file), "utf8"));
  const { files } = listSourceFiles(root, { roots: [API], extensions: [".ts"] });
  const queues = /QUEUE_NAMES\s*=\s*\{([^}]*)\}/.exec(read(QUEUES))?.[1] ?? "";
  return {
    route: files
      .filter((file) => ROUTE_NAME.test(file) || ROUTE.test(read(file)))
      .map((file) => file.slice(API.length + 1)),
    package: dirsOf(root, CORE).filter((name) =>
      existsSync(path.join(root, CORE, name, "package.json"))
    ),
    worker: readdirSync(path.join(root, WORKERS)).filter((name) =>
      /(?:Worker|Handler)\.ts$/.test(name)
    ),
    queue: [...queues.matchAll(/\b[A-Z_]\w*\s*:\s*"([^"]+)"/g)].map(([, name = ""]) => name),
    admin: sectionsOf(root, ADMIN),
    client: sectionsOf(root, CLIENT),
  };
}

/** @type {(head: string[], body: string[][]) => string} a Markdown table, or "None." with no rows */
const table = (head, body) =>
  body.length === 0
    ? "None."
    : [head, head.map(() => "---"), ...body]
        .map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`)
        .join("\n");

/** @type {(options?: { root?: string }) => Promise<Built>} derives the candidates and renders the page */
export async function buildNonFeatures({ root = REPO_ROOT } = {}) {
  const classification = loadClassification(root, CLASSIFICATION, ALLOWED);
  const { pendingBaseline, problems } = classification;
  const roots = [DIR, API, CORE, WORKERS, QUEUES, ADMIN, CLIENT];
  const missing = roots.filter((dir) => !existsSync(path.join(root, dir)));
  const sources = missing.length === 0 ? deriveCandidates(root) : {};
  const empty = Object.keys(sources).filter((kind) => sources[kind]?.length === 0);
  const scope = missing.length > 0 ? `${missing.join(", ")} does not exist` : empty.join(", ");
  if (scope !== "") {
    const why = missing.length > 0 ? scope : `${scope} yielded no candidate`;
    const scopeError = `${why}: a scan that cannot read its whole scope is not clean`;
    return { pagePath: PAGE, markdown: "", problems, scopeError };
  }
  const entries = /** @type {Map<string, Classified>} */ (classification.entries);
  const kinds = Object.entries(sources);
  const candidates = kinds
    .flatMap(([kind, names]) => names.map((name) => `${kind}:${name}`))
    .sort();
  const known = new Set(candidates);
  const docs = listDocs(root).map((file) => path.basename(file, ".md"));
  for (const id of candidates)
    if (!entries.has(id)) problems.push(`${id} has no entry: classify it`);
  for (const [id, { status, doc }] of entries) {
    if (!known.has(id)) problems.push(`${id} is classified but the tree yields no such candidate`);
    if (status === "documented" && !docs.includes(String(doc)))
      problems.push(`${id} is documented by ${doc ?? "no doc"}, which is no support doc`);
    if (status !== "documented" && doc !== undefined)
      problems.push(`${id}: doc belongs on a documented candidate, and only there`);
  }
  const statusOf = (/** @type {string} */ id) => entries.get(id)?.status ?? "unclassified";
  const ofStatus = (/** @type {string} */ s) => candidates.filter((id) => statusOf(id) === s);
  const pending = ofStatus("pending").length;
  if (pending > pendingBaseline)
    problems.push(`${pending} pending exceed pendingBaseline ${pendingBaseline}`);
  if (pending < pendingBaseline)
    problems.push(`stale pendingBaseline ${pendingBaseline}: lower it to ${pending}`);
  const code = (/** @type {string} */ id) => `\`${id}\``;
  const note = (/** @type {string} */ id) => entries.get(id)?.note ?? "";
  const said = (/** @type {string} */ id) => (note(id) ? `: ${note(id)}` : "");
  const listed = ofStatus("pending").map((id) => `- ${code(id)}${said(id)}`);
  const documented = ofStatus("documented");
  const markdown = await renderInventory({
    title: "Non-features and support coverage",
    intro: [
      "Every capability candidate the tree yields, and what covers it for support: the support page that documents it, the reason it needs none, or nothing yet. A ticket about a candidate listed under Pending has no support page to read.",
      "## Non-features",
      table(
        ["Candidate", "Why support needs no page"],
        ofStatus("non-feature").map((id) => [code(id), note(id)])
      ),
      "## Pending",
      listed.join("\n") || "None.",
      "## About this page",
      ABOUT.join("\n"),
    ],
    generatorPath: "scripts/support/non-features.mjs",
    pagePath: PAGE,
    sources: {
      "derived candidates": sha256Of(candidates.join("\n")),
      [CLASSIFICATION]: sha256Of(classification.text),
    },
    summary: Object.fromEntries([...STATUSES, "unclassified"].map((s) => [s, ofStatus(s).length])),
    columns: ["Support page", "Candidates it documents"],
    rows: docs.map((doc) => [
      `[${doc}](${doc}.md)`,
      documented
        .filter((id) => entries.get(id)?.doc === doc)
        .map(code)
        .join(", "),
    ]),
    commands: COMMANDS,
    heading: "Documented",
  });
  const counts = Object.fromEntries(kinds.map(([kind, names]) => [kind, names.length]));
  return { pagePath: PAGE, markdown, problems, counts };
}

/** @type {import("../legal/lib/inventory.mjs").Generator} */
export const generator = {
  name: "non-features",
  generate: async (/** @type {{ root?: string }} */ options = {}) => {
    const built = await buildNonFeatures(options);
    const counts = Object.entries(built.counts ?? {}).map(([kind, n]) => `${n} ${kind}`);
    if (!built.scopeError)
      process.stdout.write(`support-docs non-features: ${counts.join(", ")}\n`);
    return built;
  },
};
