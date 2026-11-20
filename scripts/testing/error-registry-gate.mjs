// @ts-check
/**
 * @file error-registry-gate.mjs
 * @description The first script of `pnpm check:errors`: the error registry under
 *   `packages/shared/src/error-registry/` is whole, every enrolled portal holds a text for each
 *   code it can receive and for nothing else, the reference page `docs/api/ERROR_CODES.md` is what
 *   the registry and the history of existing sites yield, and nothing in the lint rule's scope
 *   builds a table outside the registry or reads a table it does not hold (ADR-0047).
 *
 *   WHAT IT READS. The registry's barrel, `index.ts`, and every `domains/<name>.ts`, loaded with
 *   jiti, the root's own TypeScript loader, through one loader per run so a table read through the
 *   barrel and through its file is the same object; the module cache of the registry directory is
 *   dropped first, so a tree read twice in one process is never answered from memory. The portals,
 *   discovered as fitness #51 discovers them: a directory directly under `apps/` holding
 *   `i18n/routing.ts` and `messages/`, its id its name; of each, its `defaultLocale` line, read as
 *   fitness #51 reads it, and every catalog of `messages/`. The history of existing sites,
 *   `scripts/testing/error-sites-history/`, through the sites gate's own reader (`readHistory` and
 *   `stateOf` of `scripts/testing/error-sites-gate.mjs`), which the functions take as a parameter,
 *   so one reader of the rows' format exists. The tracked files git lists, and of them the rule's
 *   scope: what `isInErrorScope` of `scripts/testing/lib/error-scope.mjs` leaves, the one matcher
 *   the sites gate and the lint configuration read too: a file with one of the four TypeScript
 *   extensions that no entry of the exclusion list of `errors/no-inline-error` excludes, an entry of
 *   kind `outside-src` never excluding a file under a `src` directory. The list is a parameter of
 *   every exported function, and only the command reads it from that module. Before matching, the
 *   gate holds each entry to a glob string and one of the module's kinds, and has the matcher read
 *   each glob, so an entry it cannot read fails closed instead of matching nothing.
 *
 *   THE RULES. R1: every `domains/<name>.ts` has a name matching `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` and
 *   exports one table, `<NAME>_ERRORS` (the name in upper case, a hyphen read as `_`), and nothing
 *   else; a table is an object of definitions, and each entry's `domain` is `<name>`; `domains/`
 *   holds nothing but such files; every table of `ERROR_TABLES` is one domain file's table, and every
 *   domain file's table is in `ERROR_TABLES` once. R2: every key matches
 *   `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`, is at most 63 characters, and is its entry's `code`. R3: no code
 *   is in two tables. R4: `category` is one of the twelve and `status` one of its statuses. R5:
 *   `message` is a string of one line that is not blank; its `{name}` placeholders are exactly the
 *   declared parameters; it holds a letter outside its placeholders. R6: parameter names match
 *   `^[a-z][A-Za-z0-9]*$` and kinds are `string`, `number`, `boolean` or `string[]`; `fronts` is a
 *   list that names each portal at most once and only portals the tree holds. R7: a portal is
 *   enrolled once its default locale's catalog holds `errorCodes`, and nothing is asked of one that
 *   is not; in every catalog of an enrolled portal, `errorCodes` is an object that holds a string for
 *   each code whose `fronts` name the portal and for nothing else, and each such text reads only the
 *   code's declared parameters, a number or a plural only a `number` one, a select only a `string`
 *   or `boolean` one, no date or time, and holds no rich-text tag. What fitness #51 holds already, the
 *   same keys and argument names in every locale and every message valid ICU, R7 does not repeat: a
 *   text it cannot parse is an input it could not read. R8: every code is read in code, as
 *   `<TABLE>.<CODE>` (or through a namespace, `ns.<TABLE>.<CODE>`), in a file of the rule's scope
 *   outside the registry directory; a comment, a string and a computed member are not a reference.
 *   R9: `docs/api/ERROR_CODES.md` is byte for byte what `lib/error-reference-page.mjs` renders from
 *   the registry and the history; `--write` rewrites it instead, once the registry and the history
 *   were read. R10: the word `defineErrors` occurs in no file of the rule's scope outside the
 *   registry directory, in code, a string or a comment; a test file is outside the scope, so a suite
 *   that builds a table to prove the kernel is no finding. R11: every name ending in `_ERRORS` that
 *   an `of` call reads as its first argument, through parentheses and casts, is the export name of a
 *   table of `ERROR_TABLES`. The gate holds its own copy of the code grammar, the twelve categories
 *   and their statuses: it is the check of the registry's rules, so a registry that loosened them
 *   would loosen nothing here.
 *
 *   EXIT CODES. 0 clean: `error-registry-gate: PASS`, `<n> codes in <m> domains` and, per portal,
 *   `<portal>: enrolled, <k> codes` or `<portal>: not enrolled` on stdout, after
 *   `error-registry-gate: wrote docs/api/ERROR_CODES.md` when it wrote the page. 1 a verdict, one
 *   line each on stderr, `error-registry-gate: <code or path>: <problem> (R<n>)`. 2 a usage error. 3
 *   an input that could not be read, which wins over 1 and prints its lines before the verdict's:
 *   the root is not a directory; the exclusion list is not a non-empty array of entries, each with a
 *   glob the matcher reads and a known kind; fewer than two portals; a routing file that cannot be
 *   read or holds no one `defaultLocale` line; a catalog that is not JSON or not an object; no
 *   catalog for the default locale; a text of an enrolled portal that is not valid ICU; `domains/`
 *   is missing or holds no `<name>.ts`; the barrel or a domain file cannot be loaded;
 *   `ERROR_TABLES` is missing, not an array or empty; the history's reader fails or reports a row
 *   that is not the format of its rows; the page cannot be read for a reason other than its
 *   absence; `git ls-files` fails or lists no source file of the scope; a tracked file of the scope
 *   cannot be read; the command cannot load the sites gate's reader. A check that needs an input
 *   that was not read is skipped, never run on part of it, and the page is never written from one.
 *   Every printed path is relative to the root.
 *
 *   RESIDUAL LIMITS. R8 proves a reference, not an emission. A domain file's type-only export
 *   leaves nothing at run time, so R1 cannot see it. R10 reads text, so a name assembled from parts
 *   (`ns["define" + "Errors"]`) passes it; the lint rule's `registryDefinition` reads the import that
 *   such a read needs. R11 reads calls by their syntax: an `of` reached through an alias is the lint
 *   rule's `classReference`. R7 holds a text to the code it is keyed by, not to the meaning of the
 *   code: a translation that says something else passes it.
 *
 *   Usage: `node scripts/testing/error-registry-gate.mjs [--write] [--root <dir>]`. The root
 *   defaults to the repository this file lives in, found from the script's own URL. Pinned by
 *   apps/api/tests/unit/scripts/errorRegistryGate.test.ts, and the page by
 *   apps/api/tests/unit/scripts/errorReferencePage.test.ts.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  parse,
} from "@formatjs/icu-messageformat-parser";
import { createJiti } from "jiti";
import ts from "typescript";
import { PAGE, renderReferencePage, WRITE_COMMAND } from "./lib/error-reference-page.mjs";
import {
  ERROR_SCOPE_EXCLUSIONS,
  EXCLUSION_KIND,
  isInErrorScope,
  matchesGlob,
} from "./lib/error-scope.mjs";

/** The registry's directory, relative to the root. */
export const REGISTRY_DIRECTORY = "packages/shared/src/error-registry";
/** The lint rule whose scope R8, R10 and R11 read. */
export const RULE_ID = "errors/no-inline-error";

const GATE = "error-registry-gate";
const PREFIX = `${GATE}: `;
const USAGE = "usage: node scripts/testing/error-registry-gate.mjs [--write] [--root <dir>]";
const SCOPE_MODULE = "scripts/testing/lib/error-scope.mjs";
const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOMAINS_DIRECTORY = `${REGISTRY_DIRECTORY}/domains`;
const INDEX = `${REGISTRY_DIRECTORY}/index.ts`;

const EXIT_CLEAN = 0;
const EXIT_VERDICT = 1;
const EXIT_USAGE = 2;
const EXIT_UNREAD = 3;

/** The portals this repository holds today (admin, client); fewer means the scan read too little. */
const PORTAL_FLOOR = 2;
/**
 * The kinds an entry of an exclusion list may have, from the module that defines them.
 *
 * @type {readonly string[]}
 */
const KINDS = Object.values(EXCLUSION_KIND);

const DOMAIN_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** AIP-193's grammar and length, which the registry's `ERROR_CODE_PATTERN` states too. */
const CODE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const CODE_MAX_LENGTH = 63;
const PARAMETER_NAME = /^[a-z][A-Za-z0-9]*$/;
const PARAMETER_KINDS = ["string", "number", "boolean", "string[]"];
/** The twelve categories and the statuses each takes. */
const CATEGORY_STATUSES = new Map(
  Object.entries({
    validation: [400, 415, 422],
    authentication: [401],
    permission: [403],
    not_found: [404],
    conflict: [409],
    too_large: [413],
    rate_limit: [429],
    not_implemented: [501],
    upstream: [502, 504],
    unavailable: [503],
    configuration: [500],
    internal: [500],
  })
);
const PLACEHOLDER = /\{([^{}]*)\}/g;
const LETTER = /\p{L}/u;
const LINE_BREAK = /[\r\n\p{Zl}\p{Zp}]/u;
/** A name an `of` call may read as a table: what the lint rule's `definitionSource` reads. */
const TABLE_NAME = /_ERRORS$/;
/** The word as an identifier would end it, so `redefineErrorsOnce` is another word. */
const DEFINE_ERRORS = /(?<![\w$])defineErrors(?![\w$])/;

/** The history of existing sites, which the sites gate reads and the reference page shows. */
const HISTORY_DIRECTORY = "scripts/testing/error-sites-history";
/** A portal's namespace of error texts, keyed by code, in each of its catalogs. */
const NAMESPACE = "errorCodes";
/** The routing's `defaultLocale` line, read as fitness #51 reads it: one line, one literal. */
const DEFAULT_LOCALE_LINE =
  /^[ \t]*defaultLocale:[ \t]*(["'])([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)\1[ \t]*,?[ \t]*$/gm;

/** Git variables that would point the listing at a repository other than the root's. */
const FOREIGN_GIT_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

const nodeRequire = createRequire(import.meta.url);

/**
 * @typedef {object} Outcome
 * @property {number} exitCode
 * @property {string[]} stdout The lines written to standard output.
 * @property {string[]} stderr The lines written to standard error.
 */

/**
 * @typedef {object} Domain
 * @property {string} file The domain file, relative to the root.
 * @property {string} name The file's name without `.ts`.
 * @property {string | null} exportName The export read as its table: the expected name when it
 *   exports it, else its one export, else none.
 * @property {unknown} value The value of that export.
 * @property {Record<string, unknown> | null} table The value when it is an object of entries.
 */

/**
 * @typedef {Record<"R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11", string[]>} Findings
 */

/** @typedef {import("./lib/error-scope.mjs").Exclusion} Exclusion */
/** @typedef {import("./lib/error-reference-page.mjs").PageRow} PageRow */
/** @typedef {import("./lib/error-reference-page.mjs").PageSites} PageSites */

/**
 * @typedef {object} HistoryRow One row of the history, as the sites gate reads it.
 * @property {string} file The row's file, relative to the root.
 * @property {{ born?: { rule: string, contexts: Record<string, number> },
 *   fixed?: Record<string, number>, moved?: { from: string, to: string, count: number }[] }} row
 */

/**
 * @typedef {object} HistoryReader The sites gate's reader of the history and the state it
 *   yields, which the gate takes as a parameter so one reader of the format exists.
 * @property {(root: string) => { exists: boolean, rows: HistoryRow[], problems: string[] }} read
 * @property {(rows: readonly HistoryRow[]) => ReadonlyMap<string, number>} stateOf
 */

/**
 * @typedef {object} Catalog One locale's catalog of a portal.
 * @property {string} file The catalog, relative to the root.
 * @property {string} locale
 * @property {Record<string, unknown>} messages
 */

/**
 * @typedef {object} Portal
 * @property {string} id
 * @property {boolean} enrolled True when its default locale's catalog holds the namespace.
 * @property {Catalog[]} catalogs Every locale's catalog, in locale order.
 */

/**
 * @description Names the type of a value, with its article, for a problem line.
 * @param {unknown} value Any value.
 * @returns {string} `null`, `undefined`, `an array`, `an object`, or `a <type>`.
 */
function describe(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/**
 * @description Shows a value as JSON, or by its type when JSON has no text for it.
 * @param {unknown} value Any value.
 * @returns {string} The text.
 */
function shown(value) {
  const text = JSON.stringify(value);
  return text === undefined ? describe(value) : text;
}

/**
 * @description Tells whether a value is an object that is not an array.
 * @param {unknown} value Any value.
 * @returns {value is Record<string, unknown>} True for a plain-shaped object.
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @description Joins items as a sentence does: `a`, `a and b`, `a, b and c`.
 * @param {readonly string[]} items The items.
 * @param {string} conjunction `and` or `or`.
 * @returns {string} The phrase.
 */
function listOf(items, conjunction) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1] ?? ""}`;
}

/**
 * @description Counts a noun.
 * @param {number} count The count.
 * @param {string} noun The noun in the singular.
 * @returns {string} `1 code`, `3 codes`.
 */
function plural(count, noun) {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * @description The first line of what a failure says: a child process's standard error when it
 *   wrote one, a file system code when there is one, else the message.
 * @param {unknown} error The thrown value.
 * @returns {string} One line.
 */
function reasonOf(error) {
  if (error instanceof Error) {
    const stderr = "stderr" in error ? String(error.stderr ?? "").trim() : "";
    if (stderr !== "") return stderr.split(/\r?\n/)[0] ?? stderr;
    if ("code" in error && typeof error.code === "string" && error.code.startsWith("E")) {
      return error.code;
    }
    return error.message.trim().split(/\r?\n/)[0] ?? error.message;
  }
  return String(error);
}

/**
 * @description Tells whether a path is a directory, without throwing when it does not exist.
 * @param {string} target The path.
 * @returns {boolean} True for a directory.
 */
function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @description Tells whether a path is a regular file, without throwing when it does not exist.
 * @param {string} target The path.
 * @returns {boolean} True for a file.
 */
function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * @description Holds the rule's exclusion list to what the shared matcher reads: a non-empty array
 *   of entries, each with a glob string the matcher can read and one of the module's kinds, since
 *   the kind decides what an entry may exclude.
 * @param {unknown} exclusions The list of `{ glob, kind, reason }` entries.
 * @returns {{ list: readonly Exclusion[] } | { problem: string }} The list, or why it cannot be
 *   read.
 */
function readExclusions(exclusions) {
  /** @type {(problem: string) => { problem: string }} */
  const unreadable = (problem) => ({
    problem:
      `${SCOPE_MODULE}: the exclusion list of ${RULE_ID} ${problem}, so the rule's scope cannot ` +
      "be told",
  });
  if (!Array.isArray(exclusions)) return unreadable(`is ${describe(exclusions)}, not an array`);
  if (exclusions.length === 0) return unreadable("is empty");
  /** @type {Exclusion[]} */
  const list = [];
  for (const [index, entry] of exclusions.entries()) {
    const glob = isRecord(entry) ? entry.glob : undefined;
    const kind = isRecord(entry) ? entry.kind : undefined;
    if (typeof glob !== "string") {
      return unreadable(`holds entry ${String(index)} with no glob string`);
    }
    if (typeof kind !== "string" || !KINDS.includes(kind)) {
      return unreadable(
        `holds entry ${String(index)} with the kind ${shown(kind)}, which is none of ` +
          listOf(KINDS, "and")
      );
    }
    try {
      matchesGlob("", glob);
    } catch {
      return unreadable(
        `holds the glob ${JSON.stringify(glob)}, whose syntax the gate does not read (it reads *, ` +
          "** and {a,b})"
      );
    }
    list.push(/** @type {Exclusion} */ (entry));
  }
  return { list };
}

/**
 * @description Lists the portals of a tree: every directory directly under `apps/` holding both
 *   `i18n/routing.ts` and `messages/`, in name order.
 * @param {string} root The tree's root.
 * @returns {string[]} The portal ids.
 */
function discoverPortals(root) {
  const apps = path.join(root, "apps");
  if (!isDirectory(apps)) return [];
  return readdirSync(apps)
    .filter(
      (name) =>
        isFile(path.join(apps, name, "i18n", "routing.ts")) &&
        isDirectory(path.join(apps, name, "messages"))
    )
    .sort();
}

/**
 * @description Reads one portal for R7: its default locale from its routing, as fitness #51 reads
 *   it, and every catalog of `messages/`. The portal is enrolled when its default locale's catalog
 *   holds the `errorCodes` namespace.
 * @param {string} root The tree's root.
 * @param {string} id The portal's id, its directory under `apps/`.
 * @param {string[]} unread Where what could not be read goes.
 * @returns {Portal | null} The portal, or null when its enrolment could not be read.
 */
function readPortal(root, id, unread) {
  const routing = `apps/${id}/i18n/routing.ts`;
  const directory = `apps/${id}/messages`;
  /** @type {string} */
  let text;
  try {
    text = readFileSync(path.join(root, routing), "utf8");
  } catch (error) {
    unread.push(
      `${routing}: could not be read, so ${id}'s enrolment was not read: ${reasonOf(error)}`
    );
    return null;
  }
  const lines = [...text.matchAll(DEFAULT_LOCALE_LINE)];
  const defaultLocale = lines.length === 1 ? lines[0]?.[2] : undefined;
  if (defaultLocale === undefined) {
    unread.push(
      `${routing}: holds ${lines.length === 0 ? "no" : String(lines.length)} \`defaultLocale: "<locale>"\` ` +
        `line${lines.length === 1 ? "" : "s"} where the gate reads exactly one, so ${id}'s ` +
        "enrolment was not read"
    );
    return null;
  }
  /** @type {Catalog[]} */
  const catalogs = [];
  let whole = true;
  const names = readdirSync(path.join(root, directory))
    .filter((name) => name.endsWith(".json") && isFile(path.join(root, directory, name)))
    .sort();
  for (const name of names) {
    const file = `${directory}/${name}`;
    /** @type {unknown} */
    let messages;
    try {
      messages = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    } catch (error) {
      unread.push(`${file}: could not be read as JSON, so R7 did not read it: ${reasonOf(error)}`);
      whole = false;
      continue;
    }
    if (!isRecord(messages)) {
      unread.push(
        `${file}: is ${describe(messages)}, not an object of messages, so R7 did not read it`
      );
      whole = false;
      continue;
    }
    catalogs.push({ file, locale: name.slice(0, -".json".length), messages });
  }
  if (!whole) return null;
  const reference = catalogs.find((catalog) => catalog.locale === defaultLocale);
  if (reference === undefined) {
    unread.push(
      `${directory}/${defaultLocale}.json: does not exist, so ${id}'s enrolment was not read`
    );
    return null;
  }
  return { id, enrolled: Object.hasOwn(reference.messages, NAMESPACE), catalogs };
}

/**
 * @description R7 on one message of a namespace: every argument it reads is a declared parameter
 *   of a kind its format can take (a number or a plural reads a number, a select a string or a
 *   boolean, no kind is a date or a time), and it holds no rich-text tag.
 * @param {string} subject The message, as a problem line names it.
 * @param {string} code The message's code.
 * @param {import("@formatjs/icu-messageformat-parser").MessageFormatElement[]} elements The parsed
 *   message.
 * @param {Record<string, unknown>} params The code's declared parameters.
 * @param {string[]} r7 Where R7's findings go.
 * @returns {void}
 */
function judgeArguments(subject, code, elements, params, r7) {
  const said = new Set();
  /** @type {(line: string) => void} */
  const say = (line) => {
    if (!said.has(line)) r7.push(line);
    said.add(line);
  };
  /** @type {(nodes: import("@formatjs/icu-messageformat-parser").MessageFormatElement[]) => void} */
  const visit = (nodes) => {
    for (const node of nodes) {
      if (isTagElement(node)) {
        say(`${subject} holds the tag <${node.value}>; an error text holds no tag (R7)`);
        visit(node.children);
        continue;
      }
      if (isDateElement(node) || isTimeElement(node)) {
        say(
          `${subject} reads {${node.value}} as a ${isDateElement(node) ? "date" : "time"}, and no ` +
            "parameter kind is one (R7)"
        );
        continue;
      }
      // What a node reads: its parameter and the format it needs, none for a bare argument.
      /** @type {{ name: string, format: string | null } | null} */
      const read = isArgumentElement(node)
        ? { name: node.value, format: null }
        : isNumberElement(node)
          ? { name: node.value, format: "a number" }
          : isPluralElement(node)
            ? { name: node.value, format: "a plural" }
            : isSelectElement(node)
              ? { name: node.value, format: "a select" }
              : null;
      // A literal or the `#` of a plural reads no parameter.
      if (read === null) continue;
      const { name, format } = read;
      const kind = Object.hasOwn(params, name) ? params[name] : undefined;
      if (kind === undefined) {
        say(`${subject} reads {${name}}, which ${code} does not declare (R7)`);
      } else if (format !== null) {
        const takes = format === "a select" ? ["string", "boolean"] : ["number"];
        if (typeof kind !== "string" || !takes.includes(kind)) {
          say(
            `${subject} reads {${name}} as ${format}, which takes a ` +
              `${listOf(takes, "or")} parameter; ${code} declares it ` +
              `${typeof kind === "string" ? kind : shown(kind)} (R7)`
          );
        }
      }
      if (isPluralElement(node) || isSelectElement(node)) {
        for (const option of Object.values(node.options)) visit(option.value);
      }
    }
  };
  visit(elements);
}

/**
 * @description R7 on one enrolled portal: in every locale's catalog, the namespace holds a text
 *   for every code whose `fronts` name the portal and for nothing else, and each text reads only
 *   the code's declared parameters, each in a form its kind takes.
 * @param {Portal} portal The portal.
 * @param {ReadonlyMap<string, Record<string, unknown>>} definitions The registry's entries by code.
 * @param {string[]} r7 Where R7's findings go.
 * @param {string[]} unread Where a text that cannot be parsed goes.
 * @returns {string[]} The codes the portal can receive, in name order.
 */
function judgePortal(portal, definitions, r7, unread) {
  const receivable = [...definitions]
    .filter(
      ([, definition]) => Array.isArray(definition.fronts) && definition.fronts.includes(portal.id)
    )
    .map(([code]) => code)
    .sort();
  if (!portal.enrolled) return receivable;
  for (const catalog of portal.catalogs) {
    const at = catalog.file;
    if (!Object.hasOwn(catalog.messages, NAMESPACE)) {
      r7.push(
        `${at}: holds no ${NAMESPACE}, which ${portal.id}'s default locale holds, so no code ` +
          `${portal.id} can receive has its text in this locale (R7)`
      );
      continue;
    }
    const namespace = catalog.messages[NAMESPACE];
    if (!isRecord(namespace)) {
      r7.push(
        `${at}: ${NAMESPACE} is ${describe(namespace)}, not an object of messages keyed by code (R7)`
      );
      continue;
    }
    for (const code of receivable) {
      if (!Object.hasOwn(namespace, code)) {
        r7.push(`${at}: has no ${NAMESPACE}.${code}, a code ${portal.id} can receive (R7)`);
      }
    }
    for (const [key, message] of Object.entries(namespace)) {
      const subject = `${at}: ${NAMESPACE}.${key}`;
      const definition = definitions.get(key);
      if (definition === undefined) {
        r7.push(`${subject} is no code of the registry (R7)`);
      } else if (!receivable.includes(key)) {
        r7.push(`${subject} is a code whose fronts do not name ${portal.id} (R7)`);
      } else if (typeof message !== "string") {
        r7.push(`${subject} is ${describe(message)}, not a message (R7)`);
      } else {
        try {
          const params = isRecord(definition.params) ? definition.params : {};
          judgeArguments(subject, key, parse(message), params, r7);
        } catch (error) {
          unread.push(
            `${subject} is not valid ICU, so R7 did not read its arguments: ${reasonOf(error)}`
          );
        }
      }
    }
  }
  return receivable;
}

/**
 * @description Reads the history of existing sites through the sites gate's reader, into what the
 *   reference page shows: every row, and the count per context at the births and now.
 * @param {string} root The tree's root.
 * @param {HistoryReader} history The reader.
 * @param {string[]} unread Where what could not be read goes.
 * @returns {{ read: boolean, sites: PageSites | null }} Whether the history was read, and its
 *   state, null when there is no history.
 */
function readSites(root, history, unread) {
  try {
    const { exists, rows, problems } = history.read(root);
    if (problems.length > 0) {
      unread.push(...problems);
      return { read: false, sites: null };
    }
    if (!exists) return { read: true, sites: null };
    /** @type {PageRow[]} */
    const pageRows = rows.map(({ file, row }) => ({
      file,
      born: row.born,
      fixed: row.fixed,
      moved: row.moved,
    }));
    return {
      read: true,
      sites: {
        rows: pageRows,
        births: history.stateOf(rows.filter(({ row }) => row.born !== undefined)),
        now: history.stateOf(rows),
      },
    };
  } catch (error) {
    unread.push(
      `${HISTORY_DIRECTORY}: could not be read, so the page's existing sites were not read: ` +
        reasonOf(error)
    );
    return { read: false, sites: null };
  }
}

/**
 * @description R9: renders the reference page from what was read and, with `write`, writes it, or
 *   else holds the committed page to it byte for byte.
 * @param {string} root The tree's root.
 * @param {Domain[]} domains The domains read.
 * @param {PageSites | null} sites The history's state, or null when there is no history.
 * @param {boolean} write Whether to write the page instead of checking it.
 * @param {{ r9: string[], unread: string[], stdout: string[] }} out Where the findings, what could
 *   not be read and the line that reports a write go.
 * @returns {Promise<void>}
 */
async function judgePage(root, domains, sites, write, out) {
  const page = await renderReferencePage({
    domains: domains.flatMap((domain) =>
      domain.table === null
        ? []
        : [
            {
              name: domain.name,
              codes: Object.entries(domain.table).flatMap(([code, definition]) =>
                isRecord(definition)
                  ? [
                      {
                        code,
                        category: definition.category,
                        status: definition.status,
                        message: definition.message,
                        params: definition.params,
                        fronts: definition.fronts,
                      },
                    ]
                  : []
              ),
            },
          ]
    ),
    sites,
  });
  const target = path.join(root, PAGE);
  if (write) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, page);
    out.stdout.push(`${PREFIX}wrote ${PAGE}`);
    return;
  }
  /** @type {string} */
  let committed;
  try {
    committed = readFileSync(target, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      out.r9.push(
        `${PAGE}: does not exist; ${WRITE_COMMAND} writes it from the registry and the history (R9)`
      );
    } else {
      out.unread.push(`${PAGE}: could not be read, so R9 did not compare it: ${reasonOf(error)}`);
    }
    return;
  }
  if (committed !== page) {
    out.r9.push(
      `${PAGE}: is not what the registry and the history yield; ${WRITE_COMMAND} rewrites it (R9)`
    );
  }
}

/**
 * @description Lists `domains/`: its `<name>.ts` files, and everything else it holds.
 * @param {string} root The tree's root.
 * @returns {{ files: string[], others: string[], problem: string | null }} The domain files, the
 *   other entries, and why no table can be read when that is so.
 */
function listDomainFiles(root) {
  const directory = path.join(root, DOMAINS_DIRECTORY);
  if (!isDirectory(directory)) {
    return {
      files: [],
      others: [],
      problem: `${DOMAINS_DIRECTORY}/: does not exist, so no table was read`,
    };
  }
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name);
  const others = entries.filter((entry) => !files.includes(entry.name)).map((entry) => entry.name);
  return {
    files,
    others,
    problem:
      files.length === 0
        ? `${DOMAINS_DIRECTORY}/: holds no <name>.ts file, so no table was read`
        : null,
  };
}

/**
 * @description Drops every module of a directory from Node's module cache, where jiti keeps the
 *   modules it loads, so the next load reads the files as they are now.
 * @param {string} directory An absolute directory.
 * @returns {void}
 */
function forgetModules(directory) {
  const prefixes = [`${directory}${path.sep}`];
  try {
    prefixes.push(`${realpathSync(directory)}${path.sep}`);
  } catch {
    // A directory that does not exist has nothing cached under its real path.
  }
  for (const key of Object.keys(nodeRequire.cache)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) delete nodeRequire.cache[key];
  }
}

/**
 * @description Loads the registry's barrel and every domain file through one loader, so a table
 *   reached through both is the same object.
 * @param {string} root The tree's root.
 * @param {string[]} files The domain files' names.
 * @returns {Promise<{ tables: unknown[] | null, modules: { file: string, module: unknown }[],
 *   unread: string[] }>} `ERROR_TABLES` when it was read, each loaded domain module, and what
 *   could not be read.
 */
async function loadRegistry(root, files) {
  const directory = path.join(path.resolve(root), REGISTRY_DIRECTORY);
  forgetModules(directory);
  const jiti = createJiti(import.meta.url, { moduleCache: true, fsCache: false });
  // A loader's message names the file by its absolute path; the gate prints paths from the root.
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  const reason = (/** @type {unknown} */ error) => reasonOf(error).replaceAll(rootPrefix, "");
  /** @type {string[]} */
  const unread = [];
  /** @type {unknown[] | null} */
  let tables = null;
  try {
    const index = await jiti.import(path.join(directory, "index.ts"));
    const value =
      isRecord(index) && Object.hasOwn(index, "ERROR_TABLES") ? index.ERROR_TABLES : null;
    const problem =
      !isRecord(index) || !Object.hasOwn(index, "ERROR_TABLES")
        ? "exports no ERROR_TABLES"
        : !Array.isArray(value)
          ? `ERROR_TABLES is ${describe(value)}, not an array of tables`
          : value.length === 0
            ? "ERROR_TABLES is empty"
            : null;
    if (problem === null && Array.isArray(value)) tables = value;
    else unread.push(`${INDEX}: ${problem ?? ""}, so no code was read`);
  } catch (error) {
    unread.push(`${INDEX}: could not be loaded, so no code was read: ${reason(error)}`);
  }
  /** @type {{ file: string, module: unknown }[]} */
  const modules = [];
  for (const file of files) {
    try {
      modules.push({ file, module: await jiti.import(path.join(directory, "domains", file)) });
    } catch (error) {
      unread.push(
        `${DOMAINS_DIRECTORY}/${file}: could not be loaded, so its table was not read: ` +
          reason(error)
      );
    }
  }
  return { tables, modules, unread };
}

/**
 * @description Reads one domain module: R1's checks of its name and its exports.
 * @param {string} file The file's name in `domains/`.
 * @param {unknown} module The loaded module.
 * @param {string[]} r1 Where R1's findings go.
 * @returns {Domain} The domain.
 */
function readDomain(file, module, r1) {
  const name = file.slice(0, -".ts".length);
  const relative = `${DOMAINS_DIRECTORY}/${file}`;
  if (!DOMAIN_NAME.test(name)) {
    r1.push(
      `${relative}: the domain name ${JSON.stringify(name)} does not match ${DOMAIN_NAME.source} (R1)`
    );
  }
  const expected = `${name.toUpperCase().replaceAll("-", "_")}_ERRORS`;
  const exports = isRecord(module) ? Object.keys(module).sort() : [];
  if (exports.length !== 1 || exports[0] !== expected) {
    r1.push(
      `${relative}: exports ${exports.length === 0 ? "nothing" : exports.join(", ")}; a domain ` +
        `file exports one table, ${expected}, and nothing else (R1)`
    );
  }
  const exportName = exports.includes(expected)
    ? expected
    : exports.length === 1
      ? (exports[0] ?? null)
      : null;
  const value = exportName !== null && isRecord(module) ? module[exportName] : undefined;
  const table = isRecord(value) ? value : null;
  if (exportName !== null && table === null) {
    r1.push(`${relative}: ${exportName} is ${describe(value)}, not a table of definitions (R1)`);
  }
  return { file: relative, name, exportName, value, table };
}

/**
 * @description Judges every entry of one table: R1's domain, R2, R4, R5 and R6.
 * @param {Domain} domain The domain, with its table.
 * @param {Record<string, unknown>} table Its table.
 * @param {string[] | null} portals The portal ids, or null when they were not read.
 * @param {Findings} findings Where the findings go.
 * @returns {void}
 */
function judgeEntries(domain, table, portals, findings) {
  for (const [code, definition] of Object.entries(table)) {
    if (!CODE.test(code)) findings.R2.push(`${code}: does not match ${CODE.source} (R2)`);
    if (code.length > CODE_MAX_LENGTH) {
      findings.R2.push(
        `${code}: is ${String(code.length)} characters long; a code is at most ` +
          `${String(CODE_MAX_LENGTH)} (R2)`
      );
    }
    if (!isRecord(definition)) {
      findings.R1.push(`${code}: is ${describe(definition)}, not a definition (R1)`);
      continue;
    }
    if (definition.domain !== domain.name) {
      findings.R1.push(
        `${code}: has domain ${shown(definition.domain)}; an entry of ${domain.file} has domain ` +
          `${JSON.stringify(domain.name)} (R1)`
      );
    }
    if (definition.code !== code) {
      findings.R2.push(
        `${code}: its entry's code is ${shown(definition.code)}; an entry's code is its key (R2)`
      );
    }
    judgeStatus(code, definition, findings.R4);
    const declared = judgeParameters(code, definition.params, findings.R6);
    judgeMessage(code, definition.message, declared, findings.R5);
    judgeFronts(code, definition.fronts, portals, findings.R6);
  }
}

/**
 * @description R4: a category of the twelve and one of its statuses.
 * @param {string} code The entry's code.
 * @param {Record<string, unknown>} definition The entry.
 * @param {string[]} r4 Where R4's findings go.
 * @returns {void}
 */
function judgeStatus(code, definition, r4) {
  const { category, status } = definition;
  const statuses = typeof category === "string" ? CATEGORY_STATUSES.get(category) : undefined;
  if (statuses === undefined) {
    r4.push(`${code}: has category ${shown(category)}, which is none of the twelve (R4)`);
  } else if (typeof status !== "number" || !statuses.includes(status)) {
    r4.push(
      `${code}: has status ${shown(status)}; category ${JSON.stringify(category)} takes ` +
        `${listOf(statuses.map(String), "or")} (R4)`
    );
  }
}

/**
 * @description R6's half on parameters: names and kinds.
 * @param {string} code The entry's code.
 * @param {unknown} params The entry's `params`.
 * @param {string[]} r6 Where R6's findings go.
 * @returns {string[]} The declared parameter names, none when `params` is not an object.
 */
function judgeParameters(code, params, r6) {
  if (!isRecord(params)) {
    r6.push(`${code}: its params are ${describe(params)}, not an object of parameter kinds (R6)`);
    return [];
  }
  for (const [name, kind] of Object.entries(params)) {
    if (!PARAMETER_NAME.test(name)) {
      r6.push(
        `${code}: the parameter name ${JSON.stringify(name)} does not match ` +
          `${PARAMETER_NAME.source} (R6)`
      );
    }
    if (typeof kind !== "string" || !PARAMETER_KINDS.includes(kind)) {
      r6.push(
        `${code}: the parameter ${name} has kind ${shown(kind)}, which is none of ` +
          `${listOf(PARAMETER_KINDS, "and")} (R6)`
      );
    }
  }
  return Object.keys(params);
}

/**
 * @description R5: one line that is not blank, whose placeholders are the declared parameters and
 *   which holds a word of its own.
 * @param {string} code The entry's code.
 * @param {unknown} message The entry's `message`.
 * @param {string[]} declared The declared parameter names.
 * @param {string[]} r5 Where R5's findings go.
 * @returns {void}
 */
function judgeMessage(code, message, declared, r5) {
  if (typeof message !== "string") {
    r5.push(`${code}: its message is ${describe(message)}, not a string (R5)`);
    return;
  }
  if (LINE_BREAK.test(message)) r5.push(`${code}: its message spans more than one line (R5)`);
  if (message.trim() === "") {
    r5.push(`${code}: its message is empty (R5)`);
    return;
  }
  const held = [...new Set([...message.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""))];
  for (const name of held) {
    if (!declared.includes(name)) {
      r5.push(`${code}: its message holds {${name}}, which is no declared parameter (R5)`);
    }
  }
  for (const name of declared) {
    if (!held.includes(name)) {
      r5.push(
        `${code}: declares the parameter ${name}, which its message does not hold as {${name}} (R5)`
      );
    }
  }
  // A message that is placeholders alone passes its text through from the call site.
  if (!LETTER.test(message.replace(PLACEHOLDER, ""))) {
    r5.push(`${code}: its message is placeholders alone; it holds no word of its own (R5)`);
  }
}

/**
 * @description R6's half on portals: a list that names each portal once and only portals the tree
 *   holds.
 * @param {string} code The entry's code.
 * @param {unknown} fronts The entry's `fronts`.
 * @param {string[] | null} portals The portal ids, or null when they were not read.
 * @param {string[]} r6 Where R6's findings go.
 * @returns {void}
 */
function judgeFronts(code, fronts, portals, r6) {
  if (!Array.isArray(fronts)) {
    r6.push(`${code}: its fronts are ${describe(fronts)}, not a list of portal ids (R6)`);
    return;
  }
  const seen = new Set();
  const repeated = new Set();
  for (const front of fronts) {
    if (seen.has(front)) repeated.add(front);
    seen.add(front);
  }
  for (const front of repeated) {
    r6.push(`${code}: its fronts name ${shown(front)} more than once (R6)`);
  }
  if (portals === null) return;
  for (const front of seen) {
    if (typeof front !== "string" || !portals.includes(front)) {
      r6.push(
        `${code}: its fronts name ${shown(front)}, which is no portal of the tree ` +
          `(${portals.join(", ")}) (R6)`
      );
    }
  }
}

/**
 * @description R1's half on `ERROR_TABLES`: every table is one domain file's, and every domain
 *   file's table is listed once.
 * @param {unknown[]} tables `ERROR_TABLES`.
 * @param {Domain[]} domains The domains read.
 * @param {string[]} r1 Where R1's findings go.
 * @returns {void}
 */
function judgeTables(tables, domains, r1) {
  tables.forEach((table, index) => {
    if (!domains.some((domain) => domain.exportName !== null && domain.value === table)) {
      r1.push(
        `${INDEX}: ERROR_TABLES[${String(index)}] is the table of no domain file; every table of ` +
          `ERROR_TABLES is the export of one ${DOMAINS_DIRECTORY}/<name>.ts (R1)`
      );
    }
  });
  for (const domain of domains) {
    if (domain.exportName === null) continue;
    const count = tables.filter((table) => table === domain.value).length;
    if (count === 0) {
      r1.push(
        `${domain.file}: ${domain.exportName} is not in ERROR_TABLES, so its codes are not found ` +
          "by their code (R1)"
      );
    } else if (count > 1) {
      r1.push(
        `${INDEX}: ERROR_TABLES lists ${domain.exportName} ${String(count)} times; it lists each ` +
          "domain's table once (R1)"
      );
    }
  }
}

/**
 * @description R3: a code in more than one table, named with every domain that holds it.
 * @param {Domain[]} domains The domains read.
 * @param {string[]} r3 Where R3's findings go.
 * @returns {void}
 */
function judgeUniqueness(domains, r3) {
  /** @type {Map<string, string[]>} */
  const holders = new Map();
  for (const domain of domains) {
    for (const code of Object.keys(domain.table ?? {})) {
      holders.set(code, [...(holders.get(code) ?? []), domain.name]);
    }
  }
  for (const [code, names] of [...holders].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (names.length > 1) {
      r3.push(
        `${code}: is in the tables of ${listOf([...names].sort(), "and")}; a code is in one table (R3)`
      );
    }
  }
}

/**
 * @description The environment for git, without the variables that would point it elsewhere: the
 *   listing is always of the root's own repository, also when a git hook runs the gate.
 * @returns {NodeJS.ProcessEnv} The environment.
 */
function gitEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !FOREIGN_GIT_VARIABLES.includes(key))
  );
}

/**
 * @description Lists the files git tracks under a root.
 * @param {string} root The tree's root.
 * @returns {{ files: string[] } | { problem: string }} Root-relative paths, or why none were read.
 */
function listTracked(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      env: gitEnvironment(),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { files: out.split("\0").filter((file) => file !== "") };
  } catch (error) {
    return { problem: `git ls-files: failed, so no tracked file was read: ${reasonOf(error)}` };
  }
}

/**
 * @description Takes the parentheses, casts and non-null assertions off an expression.
 * @param {ts.Expression} node The expression.
 * @returns {ts.Expression} The expression they wrap.
 */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * @description The name an expression reads: an identifier's, or a member's last name.
 * @param {ts.Expression} node The expression.
 * @returns {string | null} The name, or null for any other expression.
 */
function nameOf(node) {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return null;
}

/**
 * @description The table an `of` call's first argument reads: the object of its member read when
 *   that names a table, else the argument's own name, so `AUTH_ERRORS.TOO_MANY_ERRORS` reads
 *   `AUTH_ERRORS` and `ns.FAKE_ERRORS` reads `FAKE_ERRORS`.
 * @param {ts.Expression} argument The first argument.
 * @returns {string | null} The name, or null when the argument reads no name.
 */
function tableReadBy(argument) {
  const target = unwrap(argument);
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    const owner = nameOf(target.expression);
    if (owner !== null && TABLE_NAME.test(owner)) return owner;
    return ts.isPropertyAccessExpression(target) ? target.name.text : owner;
  }
  return ts.isIdentifier(target) ? target.text : null;
}

/**
 * @description Reads a source file's syntax for R8 and R11: every `<name>.<name>` member read, and
 *   every name ending in `_ERRORS` that an `of` call reads as its first argument.
 * @param {string} file The file, relative to the root.
 * @param {string} text Its text.
 * @returns {{ members: string[], ofReads: { name: string, line: number }[] }} The member reads as
 *   `<object>.<member>`, and the `of` reads with their one-based line.
 */
function readSyntax(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  /** @type {string[]} */
  const members = [];
  /** @type {{ name: string, line: number }[]} */
  const ofReads = [];
  /** @type {(node: ts.Node) => void} */
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const owner = nameOf(node.expression);
      if (owner !== null) members.push(`${owner}.${node.name.text}`);
    } else if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const isOf =
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "of") ||
        (ts.isIdentifier(callee) && callee.text === "of");
      const first = node.arguments[0];
      const name = isOf && first !== undefined ? tableReadBy(first) : null;
      if (name !== null && TABLE_NAME.test(name)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        ofReads.push({ name, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { members, ofReads };
}

/**
 * @description R8, R10 and R11 over the files of the rule's scope.
 * @param {{ file: string, text: string }[]} sources The scope's files and their text.
 * @param {Domain[]} domains The domains read.
 * @param {Set<string> | null} tableNames The export names of the tables of `ERROR_TABLES`, or null
 *   when it was not read.
 * @param {Findings} findings Where the findings go.
 * @returns {void}
 */
function judgeSources(sources, domains, tableNames, findings) {
  const inRegistry = (/** @type {string} */ file) => file.startsWith(`${REGISTRY_DIRECTORY}/`);
  const exportNames = domains.flatMap((domain) =>
    domain.exportName === null ? [] : [domain.exportName]
  );
  /** @type {Set<string>} */
  const referenced = new Set();
  for (const { file, text } of sources) {
    if (!inRegistry(file)) {
      text.split(/\r?\n/).forEach((line, index) => {
        if (DEFINE_ERRORS.test(line)) {
          findings.R10.push(
            `${file}:${String(index + 1)}: names defineErrors, which only ${REGISTRY_DIRECTORY}/ ` +
              "may name in the rule's scope (R10)"
          );
        }
      });
    }
    // Only a file that names a table, or a name an `of` call could read, needs its syntax.
    if (!text.includes("_ERRORS") && !exportNames.some((name) => text.includes(name))) continue;
    const { members, ofReads } = readSyntax(file, text);
    if (!inRegistry(file)) for (const member of members) referenced.add(member);
    if (tableNames === null) continue;
    for (const { name, line } of ofReads) {
      if (!tableNames.has(name)) {
        findings.R11.push(
          `${file}:${String(line)}: an of call reads ${name} as its first argument, which is no ` +
            "table of ERROR_TABLES (R11)"
        );
      }
    }
  }
  for (const domain of domains) {
    if (domain.exportName === null || domain.table === null) continue;
    for (const code of Object.keys(domain.table)) {
      if (!referenced.has(`${domain.exportName}.${code}`)) {
        findings.R8.push(
          `${code}: no tracked file of the rule's scope outside ${REGISTRY_DIRECTORY}/ references ` +
            `${domain.exportName}.${code} (R8)`
        );
      }
    }
  }
}

/**
 * @description Reads the files of the rule's scope: the tracked files `isInErrorScope` keeps.
 * @param {string} root The tree's root.
 * @param {readonly Exclusion[]} list The rule's exclusion list.
 * @returns {{ sources: { file: string, text: string }[] } | { problems: string[] }} Every file of
 *   the scope with its text, or why they could not all be read.
 */
function readScope(root, list) {
  const tracked = listTracked(root);
  if ("problem" in tracked) return { problems: [tracked.problem] };
  const files = tracked.files.filter((file) => isInErrorScope(file, list));
  if (files.length === 0) {
    return {
      problems: [
        "git ls-files: lists no source file of the rule's scope, so R8, R10 and R11 read nothing",
      ],
    };
  }
  /** @type {{ file: string, text: string }[]} */
  const sources = [];
  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    try {
      sources.push({ file, text: readFileSync(path.join(root, file), "utf8") });
    } catch (error) {
      problems.push(
        `${file}: is tracked and could not be read, so R8, R10 and R11 read nothing: ` +
          reasonOf(error)
      );
    }
  }
  return problems.length > 0 ? { problems } : { sources };
}

/**
 * @description Judges a tree: the registry's rules R1 to R6, R7 over the portals' catalogs, R8,
 *   R10 and R11 over the rule's scope, and R9 over the reference page, which `write` rewrites
 *   instead. Reads the registry with jiti, the scope's files from git, and the history of existing
 *   sites with the reader it is given, all under `root`.
 * @param {{ root: string, exclusions: unknown, history: HistoryReader, write?: boolean }} input
 *   `root` holds the registry, the portals and a git repository; `exclusions` is the exclusion
 *   list of `errors/no-inline-error`, entries of `{ glob, kind, reason }`; `history` is the sites
 *   gate's reader of the history and of the state it yields; `write` rewrites the reference page.
 * @returns {Promise<Outcome>} The exit code and the lines for each stream: 0 when the registry is
 *   whole, 1 on a finding, 3 when an input could not be read, with its lines first.
 */
export async function runGate({ root, exclusions, history, write = false }) {
  if (!isDirectory(root)) {
    return {
      exitCode: EXIT_UNREAD,
      stdout: [],
      stderr: [`${PREFIX}${root}: is not a directory, so nothing was read`],
    };
  }
  /** @type {string[]} */
  const unread = [];
  /** @type {string[]} */
  const stdout = [];
  /** @type {Findings} */
  const findings = {
    R1: [],
    R2: [],
    R3: [],
    R4: [],
    R5: [],
    R6: [],
    R7: [],
    R8: [],
    R9: [],
    R10: [],
    R11: [],
  };

  const scope = readExclusions(exclusions);
  if ("problem" in scope) unread.push(scope.problem);

  const found = discoverPortals(root);
  const portals = found.length >= PORTAL_FLOOR ? found : null;
  if (portals === null) {
    unread.push(
      `apps/: holds ${plural(found.length, "portal")}${found.length > 0 ? ` (${found.join(", ")})` : ""}, ` +
        `below the floor of ${String(PORTAL_FLOOR)}; a portal is a directory directly under apps/ ` +
        "holding i18n/routing.ts and messages/"
    );
  }

  const listing = listDomainFiles(root);
  if (listing.problem !== null) unread.push(listing.problem);
  for (const other of listing.others) {
    findings.R1.push(
      `${DOMAINS_DIRECTORY}/${other}: is not a <name>.ts domain file, and domains/ holds nothing ` +
        "else (R1)"
    );
  }

  const enrolments = (portals ?? []).flatMap((id) => {
    const portal = readPortal(root, id, unread);
    return portal === null ? [] : [portal];
  });

  const registry = await loadRegistry(root, listing.files);
  unread.push(...registry.unread);
  const domains = registry.modules.map(({ file, module }) => readDomain(file, module, findings.R1));
  for (const domain of domains) {
    if (domain.table !== null) judgeEntries(domain, domain.table, portals, findings);
  }
  judgeUniqueness(domains, findings.R3);
  const { tables } = registry;
  if (tables !== null) judgeTables(tables, domains, findings.R1);
  const tableNames =
    tables === null
      ? null
      : new Set(
          domains.flatMap((domain) =>
            domain.exportName !== null && tables.includes(domain.value) ? [domain.exportName] : []
          )
        );

  // The entries by code, the first table's when two hold one: R3 names the second.
  /** @type {Map<string, Record<string, unknown>>} */
  const definitions = new Map();
  for (const domain of domains) {
    for (const [code, definition] of Object.entries(domain.table ?? {})) {
      if (isRecord(definition) && !definitions.has(code)) definitions.set(code, definition);
    }
  }
  const portalLines = enrolments.map((portal) => {
    const receivable = judgePortal(portal, definitions, findings.R7, unread);
    return portal.enrolled
      ? `${portal.id}: enrolled, ${plural(receivable.length, "code")}`
      : `${portal.id}: not enrolled`;
  });

  if ("list" in scope) {
    const read = readScope(root, scope.list);
    if ("problems" in read) unread.push(...read.problems);
    else judgeSources(read.sources, domains, tableNames, findings);
  }

  // The page is what the registry and the history yield, so it is judged only when both were read.
  const registryRead = listing.problem === null && registry.unread.length === 0;
  const sites = readSites(root, history, unread);
  if (registryRead && sites.read) {
    await judgePage(root, domains, sites.sites, write, { r9: findings.R9, unread, stdout });
  }

  const verdict = Object.values(findings).flat();
  if (unread.length > 0) {
    return {
      exitCode: EXIT_UNREAD,
      stdout,
      stderr: [...unread, ...verdict].map((line) => PREFIX + line),
    };
  }
  if (verdict.length > 0) {
    return { exitCode: EXIT_VERDICT, stdout, stderr: verdict.map((line) => PREFIX + line) };
  }
  const codes = domains.reduce((sum, domain) => sum + Object.keys(domain.table ?? {}).length, 0);
  return {
    exitCode: EXIT_CLEAN,
    stdout: [
      ...stdout,
      `${PREFIX}PASS`,
      `${plural(codes, "code")} in ${plural(domains.length, "domain")}`,
      ...portalLines,
    ],
    stderr: [],
  };
}

/**
 * @description Parses the command line: `--write` and `--root <dir>`, each at most once, in any
 *   order.
 * @param {string[]} argv The arguments after the script.
 * @returns {{ root: string, write: boolean } | null} The options, or null on a usage error.
 */
function parseArguments(argv) {
  let root = null;
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write" && !write) {
      write = true;
    } else if (argument === "--root" && root === null && (argv[index + 1] ?? "") !== "") {
      root = argv[index + 1] ?? null;
      index += 1;
    } else {
      return null;
    }
  }
  return { root: root ?? DEFAULT_ROOT, write };
}

/**
 * @description Loads the sites gate's reader of the history, `readHistory` and `stateOf`, so the
 *   page reads the history through the one reader of its format.
 * @returns {Promise<HistoryReader | string>} The reader, or why it could not be loaded.
 */
async function loadHistoryReader() {
  const source = "scripts/testing/error-sites-gate.mjs";
  try {
    const sites = await import(new URL("./error-sites-gate.mjs", import.meta.url).href);
    const { readHistory, stateOf } = sites;
    if (typeof readHistory !== "function" || typeof stateOf !== "function") {
      return `${source}: exports no readHistory and stateOf, so the history of existing sites cannot be read`;
    }
    return { read: readHistory, stateOf };
  } catch (error) {
    return `${source}: could not be loaded, so the history of existing sites cannot be read: ${reasonOf(error)}`;
  }
}

/**
 * @description Runs the gate on the command line, with the exclusion list of
 *   `errors/no-inline-error` from its one home and the sites gate's reader of the history.
 * @param {string[]} argv The arguments after the script.
 * @returns {Promise<number>} The process exit code.
 */
async function main(argv) {
  const options = parseArguments(argv);
  if (options === null) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT_USAGE;
  }
  const { root, write } = options;
  if (!isDirectory(root)) {
    process.stderr.write(`${PREFIX}${root}: is not a directory, so nothing was read\n`);
    return EXIT_UNREAD;
  }
  const history = await loadHistoryReader();
  if (typeof history === "string") {
    process.stderr.write(`${PREFIX}${history}\n`);
    return EXIT_UNREAD;
  }
  const outcome = await runGate({
    root,
    exclusions: ERROR_SCOPE_EXCLUSIONS[RULE_ID],
    history,
    write,
  });
  for (const line of outcome.stdout) process.stdout.write(`${line}\n`);
  for (const line of outcome.stderr) process.stderr.write(`${line}\n`);
  return outcome.exitCode;
}

/**
 * @description True only when this file is the process entry point, so the suite's import runs
 *   nothing.
 * @returns {boolean} Whether the process was started with this file.
 */
function invokedAsScript() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsScript()) process.exitCode = await main(process.argv.slice(2));
