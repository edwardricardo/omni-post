/**
 * @file listedTestFiles.mjs
 * @description Counts the files a `tsc --listFiles` run actually opened under a
 *   given directory. Lives in its own module so the invariant can be unit-tested
 *   without importing the ratchet, whose top-level body IS the gate and would run
 *   a full compile on import.
 * @layer infrastructure
 */

/**
 * A `--listFiles` entry is the ENTIRE line: one absolute path, nothing before or
 * after it. The scope count is taken from THAT shape and nothing else.
 *
 * It used to be taken by asking whether a line merely CONTAINED the directory,
 * and that is the wrong direction to be wrong in. The ratchet runs tsc with
 * `--pretty`, so the same output also carries source excerpts, related-information
 * headers and error prose — any of which can embed an absolute path under the
 * directory being counted, and each of which would then increment it.
 * Over-counting raises no alarm; it makes the floor EASIER to clear, which
 * weakens the one assertion standing between a collapsed include glob and a green
 * report over a program the compiler never opened.
 *
 * Measured on the real output at the time of writing: substring 749, anchored 749,
 * inflation ZERO — the weakness was latent, not live, and is removed here rather
 * than waited for. The synthetic cases in the unit test are the shapes that DO
 * inflate it, and they are all shapes tsc already knows how to print.
 *
 * Pretty excerpts and related-information lines are indented, so an anchored match
 * cannot see them. The remaining way to be wrong is UNDER-counting — a listed path
 * this pattern fails to recognise — and that direction fails closed, loudly,
 * through the caller's floor check.
 */
export const LISTED_FILE = /^((?:[A-Za-z]:)?\/.*\.(?:[cm]?tsx?|[cm]?jsx?|json))$/;

/**
 * Lines matching this are diagnostic HEADERS, not listed files. The caller
 * consumes them separately; they are skipped here so a header whose path sits
 * under the directory cannot be counted as an opened file.
 */
const DIAGNOSTIC_HEADER = /^(.+?):(\d+):(\d+) - error (TS\d+): /;

/**
 * @param {string} output - Raw `tsc --listFiles` output, ANSI already stripped.
 * @param {string} directory - Slash-normalised fragment the path must contain,
 *   e.g. `/apps/api/tests/`.
 * @returns {Set<string>} The distinct listed paths under that directory. A Set
 *   rather than a counter because counting one path twice is the same defect
 *   arriving by a different road.
 */
export function listedFilesUnder(output, directory) {
  const found = new Set();
  for (const line of output.split("\n")) {
    if (DIAGNOSTIC_HEADER.exec(line)) continue;
    const normalised = line.replaceAll("\\", "/");
    const listed = LISTED_FILE.exec(normalised);
    if (listed && listed[1].includes(directory)) found.add(listed[1]);
  }
  return found;
}
