// @ts-check
/**
 * @file i18n-lint.mjs
 * @description Fitness check #51: every portal's message catalogs are complete and valid ICU for
 *   every locale its routing declares. One script for every portal, run by `pnpm check:i18n`, by
 *   the battery step `i18n` and by the Dependency Consistency job of fitness.yml.
 *
 *   DISCOVERED, NOT LISTED. A portal is every directory directly under `apps/` that holds both
 *   `i18n/routing.ts` and `messages/`; fewer than PORTAL_FLOOR portals is an input the gate could not
 *   read. A portal's locales are the basenames of its `messages/*.json`, and the routing's
 *   `locales: [...]` array and `defaultLocale: "..."` are read from routing.ts with anchored regular
 *   expressions. The two locale sets must be equal, so for the catalogs a new locale (French,
 *   German) is its two natural edits, its catalog and its entry in `locales`, and when only one is
 *   made the gate names the other. The gate reads nothing else: code that keeps its own locale list,
 *   or formats with a fixed locale, is outside it, and a new locale needs every such site too.
 *
 *   THE RULES, per portal. The reference locale is `defaultLocale`. Every leaf of every catalog
 *   (objects recursed by key, arrays by index) is a string that parses as ICU MessageFormat. Every
 *   other catalog holds the reference's key set, in both directions, and per message the reference's
 *   names: its arguments and its rich-text tags, collected through plural and select branches and
 *   inside tags, because next-intl needs a value for each of them.
 *
 *   EXIT CODES, as #48: 0 clean; 1 a violation, each printed to stderr as `i18n-lint <portal>:
 *   <problem>`; 2 a usage error; 3 an input it could not read in full (a missing `--root`, fewer than
 *   PORTAL_FLOOR portals, a routing.ts whose `locales` or `defaultLocale` cannot be read, a
 *   `messages/` with no catalog, a catalog that cannot be read or does not parse as JSON). 3 wins
 *   over 1. A clean run prints `i18n-lint: PASS` and one summary line per portal to stdout; every
 *   path printed is relative to the root, so the output is byte-stable.
 *
 *   `--root <dir>` points the gate at another tree (the suite plants fixtures there); the default is
 *   the repository root, found from this script's own path. Pinned by
 *   apps/api/tests/unit/scripts/i18nLint.test.ts.
 * @layer infrastructure
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
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

const GATE = "i18n-lint";
const USAGE = "usage: node scripts/testing/i18n-lint.mjs [--root <dir>]";

/** The portals this repository holds today (admin, client); fewer means the scan read too little. */
const PORTAL_FLOOR = 2;

const EXIT_CLEAN = 0;
const EXIT_VERDICT = 1;
const EXIT_USAGE = 2;
const EXIT_UNREAD = 3;

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A locale tag as next-intl takes it: a language subtag, then optional subtags (`zh-Hant`). */
const LOCALE_TAG = "[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*";
const LOCALE_LITERAL = new RegExp(`^(["'])(${LOCALE_TAG})\\1$`);
const LOCALES_LINE = /^[ \t]*locales:[ \t]*\[([^\]]*)\][ \t]*,?[ \t]*$/gm;
const DEFAULT_LOCALE_LINE = new RegExp(
  `^[ \\t]*defaultLocale:[ \\t]*(["'])(${LOCALE_TAG})\\1[ \\t]*,?[ \\t]*$`,
  "gm"
);

/**
 * @typedef {{ kind: "violation" | "unread", portal: string | null, text: string }} Problem
 * @typedef {import("@formatjs/icu-messageformat-parser").MessageFormatElement} MessageFormatElement
 * @typedef {{ leaves: Map<string, unknown>, names: Map<string, string[]> }} Catalog
 */

/**
 * @description Reads the message of a thrown value.
 * @param {unknown} error The thrown value.
 * @returns {string} Its message.
 */
function reason(error) {
  return error instanceof Error ? error.message : String(error);
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
 * @description Parses the command line.
 * @param {string[]} argv The arguments after the script.
 * @returns {{ root: string } | { usage: string }} The options, or the usage error.
 */
function parseOptions(argv) {
  /** @type {string | null} */
  let root = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--root") return { usage: `unknown argument ${JSON.stringify(argument)}` };
    if (root !== null) return { usage: "--root given twice" };
    const value = argv[index + 1];
    if (value === undefined || value === "") return { usage: "--root needs a directory" };
    root = value;
    index += 1;
  }
  return { root: root ?? DEFAULT_ROOT };
}

/**
 * @description Lists the portals of a tree: every directory directly under `apps/` holding both
 *   `i18n/routing.ts` and `messages/`, in name order.
 * @param {string} root The tree's root.
 * @returns {string[]} The portal names.
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
 * @description Reads the routing's `locales: [...]` array of string literals, on one line or
 *   wrapped onto several, as a formatter leaves a long one.
 * @param {string} text The routing.ts text.
 * @param {string} file The routing.ts path, relative to the root.
 * @returns {{ locales: string[] } | { problem: string }} The locales, or why they cannot be read.
 */
function readLocales(text, file) {
  const lines = [...text.matchAll(LOCALES_LINE)];
  const unreadable = `${file} holds no readable \`locales: [...]\` array of string literals`;
  if (lines.length > 1)
    return {
      problem: `${file} holds ${lines.length} \`locales: [...]\` lines; the gate reads exactly one`,
    };
  if (lines.length === 0) return { problem: unreadable };
  const body = lines[0][1];
  if (body === undefined) return { problem: unreadable };
  const items = body
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  /** @type {string[]} */
  const locales = [];
  for (const item of items) {
    const literal = LOCALE_LITERAL.exec(item);
    const tag = literal?.[2];
    if (tag === undefined) return { problem: unreadable };
    locales.push(tag);
  }
  return { locales };
}

/**
 * @description Reads the routing's `defaultLocale: "..."`, one line holding one string literal.
 * @param {string} text The routing.ts text.
 * @param {string} file The routing.ts path, relative to the root.
 * @returns {{ defaultLocale: string } | { problem: string }} The locale, or why it cannot be read.
 */
function readDefaultLocale(text, file) {
  const lines = [...text.matchAll(DEFAULT_LOCALE_LINE)];
  if (lines.length > 1)
    return {
      problem: `${file} holds ${lines.length} \`defaultLocale\` lines; the gate reads exactly one`,
    };
  if (lines.length === 0)
    return { problem: `${file} holds no readable \`defaultLocale: "..."\` string literal` };
  const tag = lines[0][2];
  if (tag === undefined)
    return { problem: `${file} holds no readable \`defaultLocale: "..."\` string literal` };
  return { defaultLocale: tag };
}

/**
 * @description Names the JSON type of a value, with its article, for a problem line.
 * @param {unknown} value A parsed JSON value.
 * @returns {string} `an array`, `a number`, `a boolean`, `a string`, `an object` or `null`.
 */
function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/**
 * @description Flattens a catalog into dot-path leaves: objects recursed by key, arrays by index.
 * @param {unknown} value The catalog or one of its nodes.
 * @param {string} prefix The dot path of the node.
 * @param {Map<string, unknown>} leaves The leaves found so far, in document order.
 * @returns {Map<string, unknown>} The same map.
 */
function flatten(value, prefix, leaves) {
  const childPath = (/** @type {string} */ key) => (prefix === "" ? key : `${prefix}.${key}`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, childPath(String(index)), leaves));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flatten(item, childPath(key), leaves);
  } else {
    leaves.set(prefix, value);
  }
  return leaves;
}

/**
 * @description Collects the names a message needs a value for: its arguments and its rich-text
 *   tags (`<b>`), through plural and select branches and inside tags.
 * @param {MessageFormatElement[]} elements The parsed message.
 * @param {Set<string>} names The names found so far.
 * @returns {Set<string>} The same set.
 */
function collectNames(elements, names) {
  for (const element of elements) {
    if (
      isArgumentElement(element) ||
      isNumberElement(element) ||
      isDateElement(element) ||
      isTimeElement(element)
    ) {
      names.add(element.value);
    } else if (isSelectElement(element) || isPluralElement(element)) {
      names.add(element.value);
      for (const option of Object.values(element.options)) collectNames(option.value, names);
    } else if (isTagElement(element)) {
      // A tag is stored as `<name>`: an ICU argument name cannot hold `<` or `>`, so a tag and an
      // argument of the same name stay two entries, and a problem line shows which one is missing.
      names.add(`<${element.value}>`);
      collectNames(element.children, names);
    }
  }
  return names;
}

/**
 * @description Reads one catalog: parses its JSON, flattens it, and parses every leaf as ICU.
 * @param {string} root The tree's root.
 * @param {string} portal The portal's name.
 * @param {string} locale The catalog's locale.
 * @param {(kind: Problem["kind"], text: string) => void} report Records a problem of the portal.
 * @returns {Catalog | null} The catalog, or null when its leaves cannot be compared.
 */
function readCatalog(root, portal, locale, report) {
  const relative = `apps/${portal}/messages/${locale}.json`;
  const label = `messages/${locale}.json`;
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    report("unread", `${relative} does not parse as JSON: ${reason(error)}`);
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    report("violation", `${label} holds ${describeType(parsed)}, not an object of messages`);
    return null;
  }
  const leaves = flatten(parsed, "", new Map());
  /** @type {Map<string, string[]>} */
  const names = new Map();
  for (const [key, value] of leaves) {
    if (typeof value !== "string") {
      report(
        "violation",
        `${label} ${JSON.stringify(key)} is ${describeType(value)}, not a string`
      );
      continue;
    }
    try {
      names.set(key, [...collectNames(parse(value), new Set())].sort());
    } catch (error) {
      report("violation", `${label} ${JSON.stringify(key)} is not valid ICU: ${reason(error)}`);
    }
  }
  return { leaves, names };
}

/**
 * @description Holds one catalog to the reference's keys and, per message, to its names.
 * @param {string} locale The catalog's locale.
 * @param {Catalog} catalog The catalog.
 * @param {string} reference The reference locale.
 * @param {Catalog} referenceCatalog The reference catalog.
 * @param {(kind: Problem["kind"], text: string) => void} report Records a problem of the portal.
 * @returns {void}
 */
function compareToReference(locale, catalog, reference, referenceCatalog, report) {
  const label = `messages/${locale}.json`;
  const referenceLabel = `the reference messages/${reference}.json`;
  for (const key of referenceCatalog.leaves.keys()) {
    if (!catalog.leaves.has(key))
      report("violation", `${label} lacks ${JSON.stringify(key)}, which ${referenceLabel} holds`);
  }
  for (const key of catalog.leaves.keys()) {
    if (!referenceCatalog.leaves.has(key))
      report("violation", `${label} holds ${JSON.stringify(key)}, which ${referenceLabel} lacks`);
  }
  for (const [key, expected] of referenceCatalog.names) {
    const actual = catalog.names.get(key);
    if (actual === undefined || actual.join("\n") === expected.join("\n")) continue;
    report(
      "violation",
      `${label} ${JSON.stringify(key)} uses {${actual.join(", ")}}, ${referenceLabel} uses {${expected.join(", ")}}`
    );
  }
}

/**
 * @description Lints one portal: its routing against its catalogs, then every catalog against the
 *   reference locale.
 * @param {string} root The tree's root.
 * @param {string} portal The portal's name.
 * @param {(kind: Problem["kind"], text: string) => void} report Records a problem of the portal.
 * @returns {string | null} The portal's summary line when it is clean, else null.
 */
function lintPortal(root, portal, report) {
  const routingFile = `apps/${portal}/i18n/routing.ts`;
  const messagesDir = `apps/${portal}/messages`;
  let reported = false;
  const record = (/** @type {Problem["kind"]} */ kind, /** @type {string} */ text) => {
    reported = true;
    report(kind, text);
  };

  /** @type {string} */
  let routingText;
  try {
    routingText = readFileSync(path.join(root, routingFile), "utf8");
  } catch (error) {
    record("unread", `${routingFile} cannot be read: ${reason(error)}`);
    return null;
  }
  const localesRead = readLocales(routingText, routingFile);
  const defaultRead = readDefaultLocale(routingText, routingFile);
  if ("problem" in localesRead) record("unread", localesRead.problem);
  if ("problem" in defaultRead) record("unread", defaultRead.problem);
  const catalogLocales = readdirSync(path.join(root, messagesDir))
    .filter((name) => name.endsWith(".json") && isFile(path.join(root, messagesDir, name)))
    .map((name) => name.slice(0, -".json".length))
    .sort();
  if (catalogLocales.length === 0)
    record("unread", `${messagesDir} holds no <locale>.json catalog`);
  if ("problem" in localesRead || "problem" in defaultRead || catalogLocales.length === 0)
    return null;

  const { locales } = localesRead;
  const { defaultLocale } = defaultRead;
  for (const locale of catalogLocales) {
    if (!locales.includes(locale)) {
      record(
        "violation",
        `messages/${locale}.json exists but ${routingFile} does not list ${JSON.stringify(locale)}`
      );
    }
  }
  for (const locale of [...new Set(locales)].sort()) {
    if (!catalogLocales.includes(locale)) {
      record(
        "violation",
        `${routingFile} lists ${JSON.stringify(locale)} but messages/${locale}.json does not exist`
      );
    }
  }
  if (!locales.includes(defaultLocale)) {
    record(
      "violation",
      `${routingFile} sets defaultLocale ${JSON.stringify(defaultLocale)}, which its locales do not list`
    );
  }

  /** @type {Map<string, Catalog>} */
  const catalogs = new Map();
  for (const locale of catalogLocales) {
    const catalog = readCatalog(root, portal, locale, record);
    if (catalog !== null) catalogs.set(locale, catalog);
  }
  const referenceCatalog = catalogs.get(defaultLocale);
  if (referenceCatalog !== undefined) {
    for (const [locale, catalog] of catalogs) {
      if (locale !== defaultLocale)
        compareToReference(locale, catalog, defaultLocale, referenceCatalog, record);
    }
  }
  if (reported || referenceCatalog === undefined) return null;
  const noun = catalogLocales.length === 1 ? "locale" : "locales";
  return `${portal}: ${catalogLocales.length} ${noun} (${catalogLocales.join(", ")}), ${referenceCatalog.leaves.size} messages, reference ${defaultLocale}`;
}

/**
 * @description Runs the gate over one tree.
 * @param {string} root The tree's root, as given.
 * @returns {{ problems: Problem[], summaries: string[] }} Every problem in order, and the summaries.
 */
function lint(root) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const summaries = [];
  if (!isDirectory(root)) {
    problems.push({ kind: "unread", portal: null, text: `--root ${root} is not a directory` });
    return { problems, summaries };
  }
  const portals = discoverPortals(root);
  if (portals.length < PORTAL_FLOOR) {
    const noun = portals.length === 1 ? "portal" : "portals";
    problems.push({
      kind: "unread",
      portal: null,
      text: `discovered ${portals.length} ${noun} under apps/, below the floor of ${PORTAL_FLOOR} (a portal is a directory directly under apps/ holding i18n/routing.ts and messages/)`,
    });
    return { problems, summaries };
  }
  for (const portal of portals) {
    const summary = lintPortal(root, portal, (kind, text) => problems.push({ kind, portal, text }));
    if (summary !== null) summaries.push(summary);
  }
  return { problems, summaries };
}

/**
 * @description Runs the gate and prints its verdict.
 * @param {string[]} argv The arguments after the script.
 * @returns {number} The process exit code.
 */
function main(argv) {
  const options = parseOptions(argv);
  if ("usage" in options) {
    process.stderr.write(`${GATE}: ${options.usage}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  /** @type {{ problems: Problem[], summaries: string[] }} */
  let verdict;
  try {
    verdict = lint(options.root);
  } catch (error) {
    process.stderr.write(
      `${GATE}: an input could not be read, so nothing was measured: ${reason(error)}\n`
    );
    return EXIT_UNREAD;
  }
  const { problems, summaries } = verdict;
  if (problems.length === 0) {
    process.stdout.write([`${GATE}: PASS`, ...summaries, ""].join("\n"));
    return EXIT_CLEAN;
  }
  for (const problem of problems) {
    const prefix = problem.portal === null ? GATE : `${GATE} ${problem.portal}`;
    process.stderr.write(`${prefix}: ${problem.text}\n`);
  }
  return problems.some((problem) => problem.kind === "unread") ? EXIT_UNREAD : EXIT_VERDICT;
}

process.exitCode = main(process.argv.slice(2));
