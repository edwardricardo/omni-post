// @ts-check
/**
 * @file artifact-language-gate.mjs
 * @description The gate behind `pnpm check:artifact-language`, fitness #53: every tracked
 *   artifact is in English and names roles (Product Owner, Maintainer), never a person. For every
 *   regular file `git ls-files` lists that is not binary (a NUL byte in its first 8000 bytes, git's
 *   own test) it counts two things:
 *   - Spanish lines: a line holding a character of `SPANISH_CHARACTERS`, or at least two distinct
 *     words of `SPANISH_STOPWORDS`;
 *   - name mentions: each word of `NAME_WORDS`, in any case, after every `github.com/edwardricardo/`
 *     URL is cut from the line up to its first character outside the URL-safe set, since a
 *     permalink is an address, not a mention. A letter or a digit continues a word and anything
 *     else ends it, so an underscore-joined identifier counts and the GitHub handle does not.
 *
 *   BASELINE, keyed per file, never per directory: `{ "<path>": { "spanish": n, "names": n } }`,
 *   holding only files with a non-zero count. Each counter of each file equals its entry in both
 *   directions: above it is new debt, below it is a stale entry, lowered in the same change. A file
 *   the baseline does not name must count zero, and an entry for a file git no longer tracks fails.
 *   Once every count is zero the file is deleted, and without it the gate requires zero.
 *   `--write` rewrites it from the tree, or deletes it at zero.
 *
 *   EXEMPTIONS. `ALLOWLIST` names a file, one line of a file, a file with the English twin that
 *   must be tracked beside it, or a rule over paths, with the counters it exempts and the reason.
 *   An entry fails when its file or its twin is not tracked, when its rule matches no tracked
 *   file, when its line rule matches other than exactly one line of its file, and when it exempts
 *   no counted line today, so a fixed text or a moved line cannot leave an inert exemption behind.
 *   A new exemption is a reviewed edit of the list, with its reason. `GENERATED` names the
 *   records a generator writes, excluded from both counters because a generator writes them,
 *   whatever their sources hold; the exclusion is structural, so it holds while a record counts
 *   zero and a record is never counted twice, and only a record git does not track fails. The
 *   baseline itself is never counted: it copies the paths it records.
 *
 *   FAIL-CLOSED, exit 3, which wins over 1: `git ls-files` failing or listing no file, a tracked
 *   file that cannot be read, and a baseline that cannot be read, is not JSON or is not an object
 *   of entries holding exactly the two non-negative integer counts, not both zero. A missing
 *   baseline is read as zero required, never as permission: every file that counts is listed.
 *
 *   RESIDUALS. (1) The heuristic is a floor: Spanish with no accented character and fewer than two
 *   stopwords on a line is invisible, and so are accents written decomposed (NFD, a vowel then a
 *   combining mark) and any file not encoded in UTF-8, such as Latin-1. (2) It also counts what is
 *   not Spanish: a French, German, Italian or Portuguese word with one of the characters, and two
 *   place names on one line, such as "Los Angeles" beside "Las Vegas". (3) Counts, not lines: a
 *   change that fixes one line of a file and adds another keeps its count and passes, and the line
 *   numbers printed for new debt are the defence. (4) A file exemption covers the whole file, so
 *   new prose in an exempt file is unseen. (5) Every `migration.sql` is exempt from both counters,
 *   applied or not: a new migration's Spanish comment passes before it is ever applied. (6) Only
 *   the name words count: the GitHub handle and any other spelling of the person are unseen.
 *
 *   Usage: `node scripts/testing/artifact-language-gate.mjs [--write] [--root <dir>]`. Exit 0 when
 *   every count equals the baseline, 1 on a verdict, 2 on a usage error, 3 on an unread input.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"spanish" | "names"} Counter */
/** @typedef {{ exitCode: number, messages: string[] }} Outcome */
/** @typedef {{ spanish: number[], names: number[], mentions: number }} Count */
/** @typedef {{ spanish: number, names: number }} Entry */
/**
 * @typedef {object} AllowEntry An exemption: one tracked path, or a rule over tracked paths.
 * @property {string} [path] The tracked path it names, exactly.
 * @property {RegExp} [pattern] The rule over tracked paths it names instead.
 * @property {RegExp} [line] The one line of `path` it exempts; without it, the whole file.
 * @property {string} [twin] The English document that must be tracked for `path` to be exempt.
 * @property {readonly Counter[]} exempt The counters it exempts.
 * @property {string} reason Why the file holds what the counters would count.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMMAND = "node scripts/testing/artifact-language-gate.mjs";
const USAGE = `usage: ${COMMAND} [--write] [--root <dir>]`;
const EXIT = Object.freeze({ CLEAN: 0, VERDICT: 1, USAGE: 2, UNREAD: 3 });
const COUNTERS = /** @type {const} */ (["spanish", "names"]);
const HINT = Object.freeze({
  spanish: "Write it in English",
  names: "Name the role (Product Owner or Maintainer), never the person",
});
const SHOWN_LINES = 10;

/** The committed counts, per file. */
export const BASELINE = "scripts/testing/artifact-language-baseline.json";

/** Characters Spanish spelling uses and English spelling never does, in either case. */
const SPANISH_CHARACTERS = /[áéíóúñü¿¡]/iu;

/**
 * Frequent Spanish function words that are rare as English words. Some are in English
 * dictionaries (`del`, `los`, `las`, `como`), so one alone never counts a line: two distinct ones
 * do, which keeps false counts low. Measured on main @ 1939e73a: the files the gate counts held
 * 155 lines counted by these words alone, with no accented character, and every one held Spanish.
 * Left out on purpose, although they are the most frequent: words English uses as words or
 * abbreviations (`no`, `con`, `sin`, `son`, `hay`, `solo`, `nada`, `algo`, `dos`, `uno`), the
 * locale codes English text here names (`en`, `es`, `de`), and the code marker `todo`.
 */
const SPANISH_STOPWORDS = new Set([
  "aunque",
  "ahora",
  "cada",
  "como",
  "cual",
  "cuando",
  "debe",
  "del",
  "desde",
  "donde",
  "entre",
  "esta",
  "estas",
  "este",
  "esto",
  "estos",
  "hacer",
  "hasta",
  "las",
  "los",
  "luego",
  "mismo",
  "muy",
  "nunca",
  "otra",
  "otro",
  "para",
  "pero",
  "por",
  "porque",
  "puede",
  "que",
  "quien",
  "siempre",
  "sobre",
  "tambien",
  "tiene",
  "una",
]);

/**
 * The words that name the person; each one is a mention. A letter or a digit continues a word, so
 * the GitHub handle `edwardricardo` is not a mention, and the files that hold only the handle
 * (CODEOWNERS, `.github/dependabot.yml`) need no exemption.
 */
const NAME_WORDS = /(?<![\p{L}\p{N}])(?:edward|vel[aá]squez)(?![\p{L}\p{N}])/giu;
/**
 * A permalink into the owner's repositories, scheme optional. It ends at the first character
 * outside the URL-safe set kept here, so a comma, a bracket, a parenthesis, `<`, `>` or a quote
 * ends it, and a name written right after it still counts.
 */
const PERMALINK = /(?:https?:\/\/)?github\.com\/edwardricardo\/[A-Za-z0-9._~/?#@!$&*+;=%:-]*/giu;

const NAMES_ONLY = Object.freeze(/** @type {Counter[]} */ (["names"]));
const SPANISH_ONLY = Object.freeze(/** @type {Counter[]} */ (["spanish"]));
const BOTH = Object.freeze(/** @type {Counter[]} */ (["spanish", "names"]));
const I18N_FIXTURE =
  "an i18n fixture: it asserts the Spanish (or another locale's) rendering of a portal, " +
  "the product's locale data";
const UNICODE_FIXTURE =
  "a Unicode fixture: it feeds non-ASCII text to the code under test, so the characters are " +
  "its input, not prose";

/**
 * The exemptions, each with its reason. A new one is a reviewed edit of this list. An entry
 * leaves when its file leaves or its text is translated: one that exempts no counted line fails.
 *
 * @type {readonly AllowEntry[]}
 */
export const ALLOWLIST = Object.freeze([
  {
    path: "docs/GOVERNANCE.md",
    exempt: NAMES_ONLY,
    reason: "it maps each role to the person who holds it, and since when",
  },
  {
    path: "apps/admin/messages/es.json",
    exempt: SPANISH_ONLY,
    reason: "the admin portal's Spanish catalog: product locale data",
  },
  {
    path: "apps/client/messages/es.json",
    exempt: SPANISH_ONLY,
    reason: "the client portal's Spanish catalog: product locale data",
  },
  ...[
    "apps/admin/tests/unit/accounts/accountsLocaleFormatting.test.tsx",
    "apps/admin/tests/unit/billing/gatewaySwitchesDates.test.tsx",
    "apps/admin/tests/unit/shared/SidebarNav.test.tsx",
    "apps/admin/tests/unit/subscriptions/subscriptionsLocaleFormatting.test.tsx",
    "apps/api/tests/unit/scripts/i18nLint.test.ts",
    "apps/client/tests/components/MentionsFeed.test.tsx",
    "apps/client/tests/integration/DashboardLayoutAISubMenu.test.tsx",
    "apps/client/tests/integration/InboxLayout.test.tsx",
    "apps/client/tests/integration/ListeningPage.test.tsx",
    "apps/client/tests/integration/RepurposePage.test.tsx",
    "apps/client/tests/integration/TrendsPage.test.tsx",
    "apps/client/tests/unit/channels/channelDateFormatters.test.tsx",
    "apps/client/tests/unit/hooks/autoSaveDraftLocale.test.ts",
    "apps/client/tests/unit/posts/contentLocaleOptions.test.tsx",
    "apps/client/tests/unit/scheduling/calendarLocaleFormatting.test.tsx",
    "apps/client/tests/unit/shared/LanguageSwitcher.test.tsx",
  ].map((file) => ({ path: file, exempt: SPANISH_ONLY, reason: I18N_FIXTURE })),
  ...[
    "apps/api/tests/integration/deletionRecordDegradation.integration.test.ts",
    "apps/api/tests/unit/generateCacheKey.base64.test.ts",
    "apps/api/tests/unit/retention/DeletionRecordDegrader.test.ts",
    "apps/api/tests/unit/security/EncryptionService.test.ts",
    "apps/api/tests/unit/webhooks/facebookWebhookProcessor.signature-feed.test.ts",
    "apps/api/tests/unit/webhooks/instagramWebhookProcessor.test.ts",
    "apps/api/tests/unit/webhooks/youtubeWebhookProcessor.test.ts",
    "apps/client/tests/integration/bulkSchedulingCsvParser.test.ts",
    "packages/core/bulk-scheduling/tests/unit/schedulingCsv.test.ts",
  ].map((file) => ({ path: file, exempt: SPANISH_ONLY, reason: UNICODE_FIXTURE })),
  {
    path: "apps/client/components/shared/LanguageSwitcher.tsx",
    exempt: SPANISH_ONLY,
    reason: "its comment quotes each locale's name in that locale, the label it renders",
  },
  {
    path: "apps/api/scripts/generate-unicode-fold-table.ts",
    exempt: SPANISH_ONLY,
    reason: "its comment shows the folding on an accented name, the input the digest normalizes",
  },
  {
    path: "apps/api/ucd/17.0.0/extracted/DerivedGeneralCategory.txt",
    exempt: SPANISH_ONLY,
    reason:
      "the Unicode Character Database file, vendored unchanged; its character names are Unicode's",
  },
  {
    path: ".claude/hooks-py/_common.py",
    line: /^GRANT_ISSUER = "[^"]*"$/u,
    exempt: NAMES_ONLY,
    reason: "GRANT_ISSUER is the identity every push and edit grant records as its issuer",
  },
  {
    path: "packages/core/inbox/src/handlers/InboxEventHandlers.ts",
    exempt: SPANISH_ONLY,
    reason:
      "DEF-151: notification text is pre-rendered in one language; the fix is a message key " +
      "rendered in the recipient's locale",
  },
  {
    path: "scripts/testing/artifact-language-gate.mjs",
    exempt: BOTH,
    reason: "the gate names the words it counts",
  },
  {
    path: "apps/api/tests/unit/scripts/artifactLanguageGate.test.ts",
    exempt: BOTH,
    reason: "the gate's suite plants Spanish lines and the name to prove it",
  },
  {
    pattern: /^infra\/prisma\/migrations\/[^/]+\/migration\.sql$/u,
    exempt: BOTH,
    reason:
      "a migration is immutable once applied: Prisma stores its checksum and refuses an edit; " +
      "the rule cannot tell an applied one from a new one, so it exempts every one",
  },
  ...["INVESTOR", "MARKETING"].map((name) => ({
    path: `docs/product/${name}_ES.md`,
    twin: `docs/product/${name}_EN.md`,
    exempt: SPANISH_ONLY,
    reason: "a Spanish edition of the English document beside it, which is the official text",
  })),
]);

/**
 * The records a generator writes, each with that generator and what it copies. Excluded from both
 * counters because a generator writes them, not because their sources are counted: the fold
 * table's generator is itself exempt, and the registry metadata the lockfile copies is not in the
 * tree. The exclusion is structural: it holds while a record counts zero, so a record is never
 * counted twice, and it is never refused as inert.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const GENERATED = new Map([
  ["ledger.json", "scripts/testing/ledger.mjs, which copies every test block's title"],
  [
    "docs/development/testing-refoundation/LEDGER.md",
    "scripts/testing/ledger.mjs, which renders the rows of ledger.json",
  ],
  ["probes.json", "scripts/testing/hard-probe.mjs, which copies each probed test's title"],
  [
    "dependency-ledger.json",
    "scripts/testing/dependency-ledger.mjs, which copies package names and the paths of their sites",
  ],
  ...["cookies-and-storage", "oauth-scopes", "personal-data", "subprocessors"].map(
    (name) =>
      /** @type {[string, string]} */ ([
        `docs/legal/inventories/${name}.generated.md`,
        `scripts/legal/${name}.mjs, which copies its scan and docs/legal/classification/${name}.json`,
      ])
  ),
  [
    "docs/support/README.md",
    "scripts/support/index.mjs, which copies each support document's front matter",
  ],
  [
    "docs/support/NON_FEATURES.md",
    "scripts/support/non-features.mjs, which copies docs/support/classification/non-features.json",
  ],
  ["eslint-suppressions.json", "eslint's --suppress-all, which copies the path of each file"],
  [
    "packages/shared/src/api-generated/index.ts",
    "scripts/generate-api-types.ts, which copies its header and the route schemas",
  ],
  [
    "packages/shared/src/api-generated/types.gen.ts",
    "scripts/generate-api-types.ts, which copies its header and the route schemas",
  ],
  [
    "apps/api/src/security/nameDigest/unicodeData.generated.ts",
    "apps/api/scripts/generate-unicode-fold-table.ts, which copies its comments",
  ],
  ["pnpm-lock.yaml", "pnpm install, which writes it from the manifests and registry metadata"],
]);

/** @type {(code: number, messages: string[]) => Outcome} */
const outcome = (exitCode, messages) => ({ exitCode, messages });

/** @type {(error: unknown) => string} */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** @type {(count: number, noun: string) => string} */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** @type {(left: string, right: string) => number} */
const byCodeUnit = (left, right) => (left < right ? -1 : Number(left > right));

/**
 * @description Lists the regular files git tracks under a root: blobs of mode 100644 or 100755,
 *   so a symbolic link or a submodule is never read through.
 * @param {string} root The repository root.
 * @returns {{ files: string[] } | { error: string }} Repository-relative paths, or why not.
 */
function trackedFiles(root) {
  /** @type {string} */
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "--stage", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return { error: `git ls-files failed in ${root}: ${messageOf(error)}` };
  }
  const files = listing
    .split("\0")
    .filter((record) => /^100(?:644|755) /u.test(record))
    .map((record) => record.slice(record.indexOf("\t") + 1));
  return { files };
}

/**
 * @typedef {object} Usage What the exemptions did over the tree.
 * @property {Set<AllowEntry>} used The entries that exempted at least one counted line.
 * @property {Map<AllowEntry, number>} lineMatches How many lines of its file each line entry
 *   matched.
 */

/**
 * @description The allowlist entries that cover a file: those naming it or a rule matching it,
 *   whose English twin, when they name one, is tracked.
 * @param {string} file A tracked path.
 * @param {ReadonlySet<string>} tracked Every tracked path.
 * @returns {AllowEntry[]} The covering entries.
 */
function entriesFor(file, tracked) {
  return ALLOWLIST.filter(
    (entry) =>
      (entry.path === file || (entry.pattern?.test(file) ?? false)) &&
      (entry.twin === undefined || tracked.has(entry.twin))
  );
}

/**
 * @description Words an entry in a message: its path, its path and line rule, or its path rule.
 * @param {AllowEntry} entry An allowlist entry.
 * @returns {string} The label.
 */
function labelOf(entry) {
  if (entry.path === undefined) return String(entry.pattern);
  return entry.line === undefined ? entry.path : `${entry.path} at ${String(entry.line)}`;
}

/**
 * @description Names every exemption that cannot stand: a file or a twin git does not track, a
 *   rule that matches no tracked file, a line rule that does not match exactly one line of its
 *   file, and an entry that exempts no counted line, so a fixed text cannot leave an inert
 *   exemption behind. A generated record is refused only when git does not track it: its
 *   exclusion is structural and holds while it counts zero.
 * @param {ReadonlySet<string>} tracked Every tracked path.
 * @param {Usage} usage What the exemptions did over the tree.
 * @returns {string[]} One message per entry that cannot stand.
 */
function exemptionProblems(tracked, usage) {
  const files = [...tracked];
  const allowlist = ALLOWLIST.flatMap((entry) => {
    const { path: file, pattern, twin, line } = entry;
    if (file !== undefined && !tracked.has(file)) {
      return [`allowlist: ${file} is not tracked: delete its entry`];
    }
    if (pattern !== undefined && !files.some((candidate) => pattern.test(candidate))) {
      return [`allowlist: ${String(pattern)} matches no tracked file: delete its entry`];
    }
    if (twin !== undefined && !tracked.has(twin)) {
      return [`allowlist: ${file}: its English twin ${twin} is not tracked`];
    }
    const matched = usage.lineMatches.get(entry) ?? 0;
    if (line !== undefined && matched !== 1) {
      return [
        `allowlist: ${file}: ${String(line)} matches ${matched} lines, and exactly one is required`,
      ];
    }
    if (usage.used.has(entry)) return [];
    return [`allowlist: ${labelOf(entry)} exempts no counted line: delete its entry`];
  });
  const generated = [...GENERATED.keys()]
    .filter((file) => !tracked.has(file))
    .map((file) => `generated: ${file} is not tracked: delete its entry`);
  return [...allowlist, ...generated];
}

/**
 * @description Counts one file's Spanish lines and name mentions. A counted line that a covering
 *   entry exempts, for that counter and, for a line entry, on its line, is not counted and marks
 *   the entry used.
 * @param {string} text The file's text.
 * @param {AllowEntry[]} entries The entries that cover the file.
 * @param {Usage} usage What the exemptions did, updated in place.
 * @returns {Count} The 1-based numbers of the counted lines, and the number of mentions.
 */
function countText(text, entries, usage) {
  /** @type {Count} */
  const count = { spanish: [], names: [], mentions: 0 };
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/u, "");
    const words = (line.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) =>
      SPANISH_STOPWORDS.has(word)
    );
    const spanish = SPANISH_CHARACTERS.test(line) || new Set(words).size >= 2;
    const mentions = line.replace(PERMALINK, "").match(NAME_WORDS)?.length ?? 0;
    const covering = entries.filter((entry) => {
      if (entry.line === undefined) return true;
      if (!entry.line.test(line)) return false;
      usage.lineMatches.set(entry, (usage.lineMatches.get(entry) ?? 0) + 1);
      return true;
    });
    /** @type {(counter: Counter) => boolean} */
    const exempted = (counter) => {
      const exempting = covering.filter((entry) => entry.exempt.includes(counter));
      exempting.forEach((entry) => usage.used.add(entry));
      return exempting.length > 0;
    };
    if (spanish && !exempted("spanish")) count.spanish.push(index + 1);
    if (mentions > 0 && !exempted("names")) {
      count.names.push(index + 1);
      count.mentions += mentions;
    }
  });
  return count;
}

/**
 * @description Counts every tracked file that is not binary, the baseline or a generated record,
 *   and records what each exemption did.
 * @param {string} root The repository root.
 * @param {string[]} files The tracked paths.
 * @returns {{ counts: Map<string, Count>, usage: Usage } | { error: string }} The files that
 *   count anything, and the exemptions' usage.
 */
function countTree(root, files) {
  const tracked = new Set(files);
  /** @type {Map<string, Count>} */
  const counts = new Map();
  /** @type {Usage} */
  const usage = { used: new Set(), lineMatches: new Map() };
  for (const file of files) {
    if (file === BASELINE || GENERATED.has(file)) continue;
    /** @type {Buffer} */
    let bytes;
    try {
      bytes = readFileSync(path.join(root, file));
    } catch (error) {
      return { error: `${file} is tracked but could not be read: ${messageOf(error)}` };
    }
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const count = countText(bytes.toString("utf8"), entriesFor(file, tracked), usage);
    if (count.spanish.length + count.mentions > 0) counts.set(file, count);
  }
  return { counts, usage };
}

/**
 * @description Reads the committed baseline: an object of entries holding exactly the two
 *   counts, each a non-negative integer, not both zero.
 * @param {string} root The repository root.
 * @returns {{ entries: Map<string, Entry> } | { absent: true } | { error: string }} Its entries,
 *   its absence, or why it cannot be read.
 */
function readBaseline(root) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(readFileSync(path.join(root, BASELINE), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { absent: true };
    const why = error instanceof SyntaxError ? "is not JSON" : "could not be read";
    return { error: `${BASELINE} ${why}: ${messageOf(error)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: `${BASELINE} is not an object of counts per file` };
  }
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  for (const [file, entry] of Object.entries(value)) {
    const keys = typeof entry === "object" && entry !== null ? Object.keys(entry).sort() : [];
    if (Array.isArray(entry) || keys.join() !== "names,spanish") {
      return { error: `${file}: an entry is an object holding exactly "spanish" and "names"` };
    }
    for (const counter of COUNTERS) {
      const count = entry[counter];
      if (!Number.isInteger(count) || count < 0) {
        return { error: `${file}: ${counter} is not a non-negative integer in ${BASELINE}` };
      }
    }
    if (entry.spanish === 0 && entry.names === 0) {
      return { error: `${file}: both counts are zero; ${BASELINE} holds only files that count` };
    }
    entries.set(file, { spanish: entry.spanish, names: entry.names });
  }
  return { entries };
}

/**
 * @description Words where a counter's lines are: the first ten numbers, then how many more.
 * @param {number[]} lines The 1-based line numbers.
 * @returns {string} `line 3`, `lines 1, 2` or `lines 1, …, 10 and 4 more`.
 */
function whereLines(lines) {
  const shown = lines.slice(0, SHOWN_LINES).join(", ");
  const more = lines.length > SHOWN_LINES ? ` and ${lines.length - SHOWN_LINES} more` : "";
  return `${lines.length === 1 ? "line" : "lines"} ${shown}${more}`;
}

/**
 * @description Compares each file's counts with its baseline entry, in both directions.
 * @param {Map<string, Count>} counts The files that count anything.
 * @param {Map<string, Entry>} entries The baseline's entries; empty when there is none.
 * @param {ReadonlySet<string>} tracked Every tracked path.
 * @returns {string[]} One message per counter that differs and per entry with no file.
 */
function compare(counts, entries, tracked) {
  const files = [...new Set([...counts.keys(), ...entries.keys()])].sort(byCodeUnit);
  return files.flatMap((file) => {
    if (!tracked.has(file)) {
      return [`${file}: in ${BASELINE}, but git tracks no such file. Delete its entry`];
    }
    const count = counts.get(file) ?? { spanish: [], names: [], mentions: 0 };
    const entry = entries.get(file) ?? { spanish: 0, names: 0 };
    return COUNTERS.flatMap((counter) => {
      const now = counter === "spanish" ? count.spanish.length : count.mentions;
      const was = entry[counter];
      const stated = `${file}: ${counter} ${now}, baseline ${was}`;
      if (now > was) {
        return [`${stated}: new debt at ${whereLines(count[counter])}. ${HINT[counter]}`];
      }
      if (now < was) {
        return [
          `${stated}: stale baseline. Lower it to ${now} in ${BASELINE} in this change ` +
            `(${COMMAND} --write)`,
        ];
      }
      return [];
    });
  });
}

/**
 * @description Writes the baseline the tree gives, one entry per counted file in code-unit
 *   order, as `JSON.stringify` with two spaces, the bytes Prettier gives an all-object record;
 *   at zero it deletes the file instead.
 * @param {string} root The repository root.
 * @param {Map<string, Count>} counts The files that count anything.
 * @returns {Outcome} What was written, or why it was not.
 */
function writeBaseline(root, counts) {
  const file = path.join(root, BASELINE);
  const files = [...counts.keys()].sort(byCodeUnit);
  try {
    if (files.length === 0) {
      rmSync(file, { force: true });
      return outcome(EXIT.CLEAN, [`every count is zero: deleted ${BASELINE}`]);
    }
    /** @type {Record<string, Entry>} */
    const record = {};
    for (const name of files) {
      const count = counts.get(name) ?? { spanish: [], names: [], mentions: 0 };
      record[name] = { spanish: count.spanish.length, names: count.mentions };
    }
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    return outcome(EXIT.UNREAD, [`${BASELINE} could not be written: ${messageOf(error)}`]);
  }
  const totals = summarize(counts);
  return outcome(EXIT.CLEAN, [
    `wrote ${BASELINE}: ${totals.files}, ${totals.spanish}, ${totals.names}`,
  ]);
}

/**
 * @description Words the totals of the counted files.
 * @param {Map<string, Count>} counts The files that count anything.
 * @returns {{ files: string, spanish: string, names: string }} Each total with its noun.
 */
function summarize(counts) {
  const values = [...counts.values()];
  const spanish = values.reduce((sum, count) => sum + count.spanish.length, 0);
  const names = values.reduce((sum, count) => sum + count.mentions, 0);
  return {
    files: plural(counts.size, "file"),
    spanish: plural(spanish, "Spanish line"),
    names: plural(names, "name mention"),
  };
}

/**
 * @description Runs the gate over a repository root. Everything it reads lives under `root` and
 *   in git's listing of it, so the suite drives the rule on scratch repositories.
 * @param {{ root?: string, write?: boolean }} [input] The root, and whether to rewrite the
 *   baseline instead of checking it.
 * @returns {Outcome} The exit code and the messages to print.
 */
export function runGate({ root = REPO_ROOT, write = false } = {}) {
  const listed = trackedFiles(root);
  if ("error" in listed) return outcome(EXIT.UNREAD, [listed.error]);
  if (listed.files.length === 0) {
    return outcome(EXIT.UNREAD, [
      `git tracks no file in ${root}: a scan that read nothing is not clean`,
    ]);
  }
  const tracked = new Set(listed.files);
  const counted = countTree(root, listed.files);
  if ("error" in counted) return outcome(EXIT.UNREAD, [counted.error]);
  const { counts, usage } = counted;
  const stale = exemptionProblems(tracked, usage);
  if (write) {
    const written = writeBaseline(root, counts);
    if (written.exitCode !== EXIT.CLEAN || stale.length === 0) return written;
    return outcome(EXIT.VERDICT, [...stale, ...written.messages]);
  }
  const baseline = readBaseline(root);
  if ("error" in baseline) return outcome(EXIT.UNREAD, [baseline.error]);
  const entries = "entries" in baseline ? baseline.entries : new Map();
  /** @type {string[]} */
  const headline = [];
  if ("absent" in baseline && counts.size > 0) {
    headline.push(
      `no ${BASELINE}, so every count must be zero, and ${plural(counts.size, "file")} ` +
        `${counts.size === 1 ? "counts" : "count"}. It is deleted only once every count is zero: ` +
        "restore it if it left early"
    );
  }
  if ("entries" in baseline && counts.size === 0) {
    headline.push(
      `every count is zero: delete ${BASELINE} in this change, and the gate requires zero from then on`
    );
  }
  const differences = counts.size === 0 ? [] : compare(counts, entries, tracked);
  const messages = [...stale, ...headline, ...differences];
  if (messages.length > 0) return outcome(EXIT.VERDICT, messages);
  const files = plural(tracked.size, "tracked file");
  if (counts.size === 0) {
    return outcome(EXIT.CLEAN, [`${files}; no Spanish line and no name mention`]);
  }
  const totals = summarize(counts);
  return outcome(EXIT.CLEAN, [
    `${files}; ${totals.spanish} and ${totals.names} in ${totals.files} equal ${BASELINE}`,
  ]);
}

/**
 * @description Reads the command line: `--write` and `--root <dir>`, each at most once.
 * @param {string[]} argv The arguments after the script.
 * @returns {{ root?: string, write: boolean } | null} The options, or `null` on a usage error.
 */
function parseArguments(argv) {
  /** @type {{ root?: string, write: boolean }} */
  const options = { write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write" && !options.write) {
      options.write = true;
    } else if (argument === "--root" && options.root === undefined) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      options.root = path.resolve(value);
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

/**
 * @description Runs the command and prints its messages: on stdout when clean, on stderr
 *   otherwise.
 * @param {string[]} argv The arguments after the script.
 * @returns {number} The exit code.
 */
function main(argv) {
  const options = parseArguments(argv);
  if (options === null) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.USAGE;
  }
  /** @type {Outcome} */
  let result;
  try {
    result = runGate(options);
  } catch (error) {
    result = outcome(EXIT.UNREAD, [`the scan failed: ${messageOf(error)}`]);
  }
  const stream = result.exitCode === EXIT.CLEAN ? process.stdout : process.stderr;
  for (const message of result.messages) stream.write(`artifact-language-gate: ${message}\n`);
  return result.exitCode;
}

/** True only when this file is the process entry point, so importing its exports runs nothing. */
const entryPoint = process.argv[1];
let isEntryPoint = false;
try {
  isEntryPoint =
    entryPoint !== undefined && realpathSync(entryPoint) === fileURLToPath(import.meta.url);
} catch {
  isEntryPoint = false;
}
if (isEntryPoint) process.exitCode = main(process.argv.slice(2));
