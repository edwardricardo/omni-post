// @ts-check
/**
 * @file checklist.mjs
 * @description Reads `docs/deployment/DEPLOYMENT_CHECKLIST.md` for `pnpm check:deployment`: its
 *   table rows, each with the heading it sits under and the words of its code spans, and its
 *   `path:line` and `path:a-b` citations. A row names a variable when one of its code spans holds
 *   the name as a whole word, so `PAYMENT_PROVIDER=stripe` names `PAYMENT_PROVIDER` and a longer
 *   name that contains it does not. A citation is a code span that is a path, then a colon and a
 *   line or a range; a span that is only `:a` or `:a-b` cites the path of the citation before it
 *   on the same line. Lines inside a fenced code block are neither rows nor citations.
 * @layer infrastructure
 */

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
const SEPARATOR = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;
const SPAN = /`([^`\n]+)`/g;
const WORD = /[A-Za-z0-9_]+/g;
/** A path's segments hold what the tree's file names hold, the routes' `[locale]` and `(auth)` included. */
const CITATION = /^((?:[\w.@()[\]-]+\/)*[\w.@()[\]-]+):(\d+)(?:-(\d+))?$/;
const CONTINUATION = /^:(\d+)(?:-(\d+))?$/;
/**
 * A path with no directory is a file only when its extension says so, so a host and port
 * (`host.docker.internal:3000`) or an image tag (`redis:7`) is no citation; an environment file
 * counts, so a citation of one is refused rather than passed over.
 */
const FILE_NAME =
  /\.(?:[cm]?[jt]sx?|json|ya?ml|md|sh|sql|prisma|toml|txt|css|html)$|^\.env(?:\.|$)/;

/** @typedef {{ line: number, section: string, words: Set<string> }} Row */
/** @typedef {{ line: number, path: string, from: number, to: number, text: string }} Citation */

/**
 * The lines outside fenced code blocks, each with its 1-based number and the heading above it.
 * @type {(text: string) => { line: number, section: string, text: string }[]}
 */
function proseLines(text) {
  let [fenced, section] = [false, ""];
  return text.split("\n").flatMap((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || FENCE.test(line)) return [];
    section = HEADING.exec(line)?.[1] ?? section;
    return [{ line: index + 1, section, text: line }];
  });
}

/** @type {(text: string) => string[]} the contents of a line's code spans */
const spansOf = (text) => [...text.matchAll(SPAN)].map(([, span = ""]) => span);

/**
 * Every table row of the checklist but the separators, with its heading and code-span words.
 * @param {string} text - The checklist's text.
 * @returns {Row[]} the rows in the page's order
 */
export function tableRows(text) {
  return proseLines(text)
    .filter(({ text: line }) => line.startsWith("|") && !SEPARATOR.test(line))
    .map(({ line, section, text: row }) => ({
      line,
      section,
      words: new Set(spansOf(row).flatMap((span) => span.match(WORD) ?? [])),
    }));
}

/**
 * Every `path:line` and `path:a-b` citation of the checklist, a continuation bound to its path.
 * @param {string} text - The checklist's text.
 * @returns {Citation[]} the citations in the page's order
 */
export function citationsOf(text) {
  return proseLines(text).flatMap(({ line, text: content }) => {
    let last = "";
    return spansOf(content).flatMap((span) => {
      const [, file = "", from = "", to = from] = CITATION.exec(span) ?? [];
      if (file.includes("/") || FILE_NAME.test(file)) {
        last = file;
        return [{ line, path: file, from: Number(from), to: Number(to), text: span }];
      }
      const [, start = "", end = start] = (last === "" ? null : CONTINUATION.exec(span)) ?? [];
      if (start === "") return [];
      return [{ line, path: last, from: Number(start), to: Number(end), text: span }];
    });
  });
}
