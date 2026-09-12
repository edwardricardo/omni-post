/**
 * @file generate-unicode-fold-table.ts
 * @description Emits `src/security/nameDigest/unicodeData.generated.ts` from the
 *              vendored UCD text files under `apps/api/ucd/<version>/`. The
 *              name-digest canonicalisation pipeline must produce the same bytes
 *              for the same name forever, so it cannot consult the runtime's
 *              Unicode tables — those move with every ICU bump. It consults
 *              THESE tables, pinned to one UCD version and reproducible from
 *              inputs whose sha256 is recorded below.
 *
 *              Dev-time only: nothing in the runtime graph imports this file.
 *              What ships is its output, and the output's own gate is
 *              `tests/unit/security/nameDigestUnicodeTable.test.ts`, which
 *              re-runs `renderUnicodeDataModule` in-process and demands the
 *              committed module back byte for byte.
 *
 *              Regenerate with: `pnpm --filter @apps/api exec tsx
 *              scripts/generate-unicode-fold-table.ts`
 * @layer infrastructure
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The pinned Unicode Character Database version. Raising it does NOT edit the
 * frozen pipeline: a different UCD version is a different canonicalisation, so
 * it mints a new `canonicalisationVersion` alongside a new key-ring generation
 * rather than changing what version 1 means.
 */
export const UCD_VERSION = "17.0.0";

/** One vendored UCD input and the sha256 that proves it was not edited. */
export interface UcdInput {
  /** Path relative to `apps/api`. */
  readonly relativePath: string;
  /** Lowercase hex sha256 of the file's exact bytes. */
  readonly sha256: string;
}

/**
 * The three inputs, in the order the generator consumes them. Each sha256 was
 * taken from the file downloaded from `unicode.org/Public/17.0.0/ucd/`; the
 * table gate re-derives them on every run, so a re-vendored or locally patched
 * input reddens rather than silently re-shaping the tables.
 */
export const UCD_INPUTS: readonly UcdInput[] = [
  {
    relativePath: `ucd/${UCD_VERSION}/CaseFolding.txt`,
    sha256: "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183",
  },
  {
    relativePath: `ucd/${UCD_VERSION}/PropList.txt`,
    sha256: "130dcddcaadaf071008bdfce1e7743e04fdfbc910886f017d9f9ac931d8c64dd",
  },
  {
    relativePath: `ucd/${UCD_VERSION}/extracted/DerivedGeneralCategory.txt`,
    sha256: "d62e5bab70ca74f099343f71224fa051cb1fdd61a1ab45c0488c44cfc0b6102e",
  },
] as const;

/** Path of the emitted module, relative to `apps/api`. */
export const GENERATED_MODULE_RELATIVE_PATH = "src/security/nameDigest/unicodeData.generated.ts";

/**
 * One semicolon-separated UCD record, already stripped of its `#` comment and
 * surrounding whitespace. UCD data lines are `field; field; ... # comment`.
 */
type UcdRecord = readonly string[];

/**
 * @function readRecords
 * @description Split a UCD text file into its data records, dropping comments
 *   and blank lines. Every UCD file in this generator shares that grammar.
 * @param text - Raw file contents.
 * @returns One entry per data line, each already split on `;` and trimmed.
 */
function readRecords(text: string): readonly UcdRecord[] {
  const records: UcdRecord[] = [];
  for (const line of text.split("\n")) {
    const body = (line.split("#")[0] ?? "").trim();
    if (body === "") continue;
    records.push(body.split(";").map((field) => field.trim()));
  }
  return records;
}

/**
 * @function parseRange
 * @description Parse a UCD range field, which is either `XXXX` or `XXXX..YYYY`.
 * @param field - The range field text.
 * @returns Inclusive `[start, end]` codepoints.
 */
function parseRange(field: string): readonly [number, number] {
  const [startText, endText] = field.split("..");
  const start = Number.parseInt(startText ?? "", 16);
  const end = endText === undefined ? start : Number.parseInt(endText, 16);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`Unparseable UCD range field: ${JSON.stringify(field)}`);
  }
  return [start, end];
}

/** A fold entry: one source codepoint and the codepoints it folds to. */
type FoldEntry = readonly [number, readonly number[]];

/**
 * @function parseFullCaseFold
 * @description Build the full case-folding map from `CaseFolding.txt`, keeping
 *   statuses C (common) and F (full) and EXCLUDING S (simple, a subset of C's
 *   domain that loses the multi-codepoint expansions) and T (Turkic, a
 *   locale-tailored variant — a name must fold the same way regardless of where
 *   it is processed).
 * @param text - Contents of `CaseFolding.txt`.
 * @returns Fold entries sorted by source codepoint.
 */
function parseFullCaseFold(text: string): readonly FoldEntry[] {
  const folds = new Map<number, readonly number[]>();
  for (const record of readRecords(text)) {
    const [codeField, status, mappingField] = record;
    if (codeField === undefined || mappingField === undefined) continue;
    if (status !== "C" && status !== "F") continue;
    const code = Number.parseInt(codeField, 16);
    const mapping = mappingField.split(/\s+/).map((cp) => Number.parseInt(cp, 16));
    if (!Number.isInteger(code) || mapping.some((cp) => !Number.isInteger(cp))) {
      throw new Error(`Unparseable CaseFolding record: ${record.join("; ")}`);
    }
    if (folds.has(code)) {
      throw new Error(`Duplicate C/F fold for U+${codeField} — the table would be ambiguous`);
    }
    folds.set(code, mapping);
  }
  return [...folds.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * @function parseRangesWithValue
 * @description Collect the ranges whose second field equals `wanted`, merging
 *   adjacent and overlapping ones so the emitted list is minimal and sorted —
 *   a binary search over it is then a total membership test.
 * @param text - Contents of a UCD file whose records are `range; value`.
 * @param wanted - The exact value to keep (`Cn`, `White_Space`, ...).
 * @returns Sorted, merged, inclusive ranges.
 */
function parseRangesWithValue(
  text: string,
  wanted: string
): readonly (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  for (const record of readRecords(text)) {
    const [rangeField, value] = record;
    if (rangeField === undefined || value !== wanted) continue;
    ranges.push(parseRange(rangeField));
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && start <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], end);
      continue;
    }
    merged.push([start, end]);
  }
  return merged;
}

/**
 * @function expandRanges
 * @description Flatten inclusive ranges into individual codepoints. Used only
 *   for White_Space, whose whole set is 25 codepoints.
 * @param ranges - Sorted inclusive ranges.
 * @returns Every codepoint the ranges cover, ascending.
 */
function expandRanges(ranges: readonly (readonly [number, number])[]): readonly number[] {
  const codepoints: number[] = [];
  for (const [start, end] of ranges) {
    for (let cp = start; cp <= end; cp += 1) codepoints.push(cp);
  }
  return codepoints;
}

/**
 * @function hex
 * @description Format a codepoint as a lowercase `0x`-prefixed literal padded
 *   to at least four digits — the shape Prettier leaves untouched, so the
 *   emitted file is stable under the repository formatter.
 * @param codepoint - The codepoint to format.
 * @returns The numeric literal text.
 */
function hex(codepoint: number): string {
  return `0x${codepoint.toString(16).padStart(4, "0")}`;
}

/**
 * @function renderUnicodeDataModule
 * @description Read the vendored inputs and render the generated module's exact
 *   text. Pure with respect to the filesystem beyond those reads, and
 *   deterministic, which is what lets the table gate compare its output against
 *   the committed bytes.
 * @param apiRoot - Absolute path of `apps/api`.
 * @returns The full text of `unicodeData.generated.ts`.
 */
export function renderUnicodeDataModule(apiRoot: string): string {
  const sources = UCD_INPUTS.map((input) =>
    readFileSync(path.join(apiRoot, input.relativePath), "utf8")
  );
  const [caseFolding, propList, derivedGeneralCategory] = sources;
  if (caseFolding === undefined || propList === undefined || derivedGeneralCategory === undefined) {
    throw new Error("UCD_INPUTS must declare CaseFolding, PropList and DerivedGeneralCategory");
  }

  const folds = parseFullCaseFold(caseFolding);
  const unassigned = parseRangesWithValue(derivedGeneralCategory, "Cn");
  const whiteSpace = expandRanges(parseRangesWithValue(propList, "White_Space"));

  const foldLines = folds
    .map(([from, to]) => `  [${hex(from)}, [${to.map(hex).join(", ")}]],`)
    .join("\n");
  const unassignedLines = unassigned
    .map(([start, end]) => `  [${hex(start)}, ${hex(end)}],`)
    .join("\n");
  // A trailing comment on every element keeps Prettier from re-flowing this
  // numeric array into fill mode, which would make the emitted text depend on
  // the formatter's line-breaking rather than on this generator.
  const whiteSpaceLines = whiteSpace
    .map((cp) => `  ${hex(cp)}, // U+${cp.toString(16).toUpperCase().padStart(4, "0")}`)
    .join("\n");

  const pins = UCD_INPUTS.map(
    (input) => ` *   - ${input.relativePath}\n *     ${input.sha256}`
  ).join("\n");

  return `/**
 * @file unicodeData.generated.ts
 * @description GENERATED FILE — DO NOT EDIT BY HAND. Produced by
 *              \`apps/api/scripts/generate-unicode-fold-table.ts\` from the
 *              vendored Unicode Character Database ${UCD_VERSION} inputs:
${pins}
 *
 *              These tables are the frozen Unicode reality that
 *              \`canonicalisationVersion\` 1 names. The runtime's own tables move
 *              with every ICU bump; a name digest that moved with them would
 *              stop verifying against the row that recorded it.
 *
 *              Regenerate with: \`pnpm --filter @apps/api exec tsx
 *              scripts/generate-unicode-fold-table.ts\`
 * @layer infrastructure
 */

/** The UCD version every table below was extracted from. */
export const UNICODE_DATA_VERSION = "${UCD_VERSION}";

/**
 * Full case folding (CaseFolding.txt statuses C and F). Status S is excluded
 * because it is the simple fold that drops multi-codepoint expansions, and
 * status T is excluded because it is the Turkic tailoring — a legal name must
 * fold identically wherever it is processed.
 */
const FOLD_ENTRIES: readonly (readonly [number, readonly number[]])[] = [
${foldLines}
];

/** Source codepoint to its full case fold. Absent means "folds to itself". */
export const FOLD_MAP: ReadonlyMap<number, readonly number[]> = new Map(FOLD_ENTRIES);

/**
 * Inclusive codepoint ranges with General_Category=Cn in this UCD version:
 * everything unassigned, reserved, or a noncharacter. A name touching one of
 * these is flagged and left intact rather than digested, because a later UCD
 * version may assign it and the fold it would then receive is not knowable now.
 * Sorted and merged, so membership is a binary search.
 */
export const UNASSIGNED_RANGES: readonly (readonly [number, number])[] = [
${unassignedLines}
];

/**
 * Every codepoint with White_Space=Yes. The canonicalisation pipeline maps each
 * of these to U+0020, collapses runs, and trims, so "Ana  Díaz" and
 * "Ana\\u00a0Díaz" reach the same digest.
 */
const WHITE_SPACE_CODEPOINTS: readonly number[] = [
${whiteSpaceLines}
];

/** White_Space=Yes membership. */
export const WHITE_SPACE: ReadonlySet<number> = new Set(WHITE_SPACE_CODEPOINTS);
`;
}

/**
 * @function main
 * @description CLI entry point: verify every vendored input against its pin,
 *   then write the generated module. The pin check runs here as well as in the
 *   test so a regeneration from edited inputs fails at the point of authorship,
 *   not later in review.
 * @returns Nothing; writes the generated module and reports what it wrote.
 */
function main(): void {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  for (const input of UCD_INPUTS) {
    const bytes = readFileSync(path.join(apiRoot, input.relativePath));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== input.sha256) {
      throw new Error(
        `${input.relativePath} does not match its pin.\n  expected ${input.sha256}\n  actual   ${digest}`
      );
    }
  }

  const target = path.join(apiRoot, GENERATED_MODULE_RELATIVE_PATH);
  writeFileSync(target, renderUnicodeDataModule(apiRoot), "utf8");
  process.stdout.write(`Wrote ${GENERATED_MODULE_RELATIVE_PATH} from UCD ${UCD_VERSION}\n`);
}

// Run the writer only when invoked directly. Imported by the table gate, this
// module must stay side-effect free so the gate renders without writing.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
