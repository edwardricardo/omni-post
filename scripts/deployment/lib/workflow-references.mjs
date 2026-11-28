// @ts-check
/**
 * @file workflow-references.mjs
 * @description The repository variables and secrets a GitHub Actions workflow reads, derived from
 *   the workflow's whole text, comments included, and never from its YAML. A context is the word
 *   `vars` or `secrets` in any letter case, a name is returned in the case it is written, and the
 *   word right after a `.` is another object's property, `steps.secrets.X`, never a context.
 *
 *   Inside each region the reader finds where GitHub evaluates an expression, every context
 *   resolves or fails. The regions are each `${{ … }}` span, which ends at the first `}}` outside
 *   a single-quoted string, as the runner reads it, or at the text's end, and each `if:` value:
 *   the rest of the key's line, a trailing comment included, and every following line indented
 *   deeper than the key, blank lines included. Inside one, a word is no
 *   context when a `-` touches it or a `.` precedes it past whitespace, which makes it part of a
 *   longer name or a property; any other context resolves to a name when, past whitespace, line
 *   breaks and the parentheses that wrap the word alone, a `.` and a name or a `[` holding one
 *   string literal follow it (`secrets . X`, `(secrets)['X']`). Every other context inside a region
 *   is a read with no name, returned with its line so that the check fails.
 *
 *   Outside every region the dotted form `secrets.X` and the index form `secrets['X']` or
 *   `vars["X"]`, written with no space before the `.` or the `[`, are read in excess, and so are
 *   the forms with no name `secrets: inherit`, `toJSON(secrets)`, `secrets.*` and an index that is
 *   no string literal; any other word, such as the one in `name: gitleaks (secrets)`, reads nothing.
 *
 *   The reader has limits, listed as residual limit (4) of check #58 in
 *   `docs/development/FITNESS_FUNCTIONS.md` and pinned by
 *   `apps/api/tests/unit/scripts/deploymentChecklist.test.ts`. Since it interprets no YAML,
 *   no alias and no escape, it misses a reference written with a space or a parenthesis, though
 *   never one written tight, where its regions do not reach: a line of an `if:` value no deeper
 *   than its key, a `${{` span of a single-quoted scalar past a `}}` one of its strings holds, an
 *   `if:` value that is an alias, and a `${{` split by an escaped line break or written through an
 *   escape. It also reads in excess: a trailing comment on an `if:` line is part of the region, so
 *   a context word in it is derived or fails the check.
 * @layer infrastructure
 */

/**
 * A context, as a whole word that is not right after a `.`, with the `toJSON(` call that opens
 * right before it, when one does.
 */
const CONTEXT = /(?:\b(toJSON)\s*\(\s*)?(?<![\w.])(vars|secrets)(?!\w)/gi;
/**
 * What follows a context: a name (`.X`, `['X']` or `["X"]`), or the object filter `.*` or an index
 * that may name nothing. Outside a region it follows the word at once; inside one, past whitespace.
 */
const TIGHT = {
  named: /\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*(?:'([^']*)'|"([^"]*)")\s*\]/y,
  unnamed: /\.(\*)|(\[)/y,
};
const SPACED = {
  named: /\s*(?:\.\s*([A-Za-z_][\w-]*)|\[\s*(?:'([^']*)'|"([^"]*)")\s*\])/y,
  unnamed: /\s*(?:\.\s*(\*)|(\[))/y,
};
/** What follows `secrets` as the key that passes every secret to a called workflow. */
const INHERIT = /["']?\s*:\s*["']?inherit(?![\w-])/iy;
/** What closes a `toJSON(` call right after the context it serializes whole. */
const CLOSES = /\s*\)/y;
/** An `if:` key, quoted or not, where a key can start: a line's start, or after a blank, `{` or `,`. */
const IF_KEY = /(?<![^\s{,])(["']?)if\1\s*:(?=\s|$)/g;
/** What opens a call rather than a grouping when it stands right before a `(`. */
const CALLER = /[\w\-)\]]/;

/** @typedef {{ line: number, context: string, form: string }} Nameless */
/** @typedef {{ start: number, end: number }} Region */
/** @typedef {{ name: string } | { form: string } | null} Read */

/** @type {(pattern: RegExp, text: string, at: number) => RegExpExecArray | null} */
function matchAt(pattern, text, at) {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/** @type {(text: string, at: number) => number} the index of the last non-blank before `at`, or -1 */
function previous(text, at) {
  let index = at - 1;
  while (index >= 0 && /\s/.test(text.charAt(index))) index -= 1;
  return index;
}

/** @type {(text: string, at: number) => number} the index of the first non-blank from `at` */
function next(text, at) {
  let index = at;
  while (index < text.length && /\s/.test(text.charAt(index))) index += 1;
  return index;
}

/** @type {(text: string, at: number) => number} the end of the line that holds `at` */
function lineEnd(text, at) {
  const end = text.indexOf("\n", at);
  return end === -1 ? text.length : end;
}

/**
 * Where a `${{` span closes: past the first `}}` outside a single-quoted string, every `'`
 * opening or closing one, or at the text's end when none does.
 * @type {(text: string, from: number) => number}
 */
function spanEnd(text, from) {
  let quoted = false;
  for (let index = from; index < text.length - 1; index += 1) {
    const char = text.charAt(index);
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "}" && text.charAt(index + 1) === "}") return index + 2;
  }
  return text.length;
}

/**
 * Every region of the text where GitHub evaluates an expression: each `${{ … }}` span and each
 * `if:` value with the lines indented deeper than its key.
 * @type {(text: string) => Region[]}
 */
function expressionRegions(text) {
  /** @type {Region[]} */
  const regions = [];
  let open = text.indexOf("${{");
  while (open !== -1) {
    const end = spanEnd(text, open + "${{".length);
    regions.push({ start: open, end });
    open = text.indexOf("${{", end);
  }
  for (const key of text.matchAll(IF_KEY)) {
    const column = key.index - (text.lastIndexOf("\n", key.index - 1) + 1);
    let end = lineEnd(text, key.index);
    while (end < text.length) {
      const following = text.slice(end + 1, lineEnd(text, end + 1));
      const indent = following.length - following.trimStart().length;
      if (following.trim() !== "" && indent <= column) break;
      end += following.length + 1;
    }
    regions.push({ start: key.index + key[0].length, end });
  }
  return regions;
}

/**
 * What follows a context at `at` in the given syntax: a name, a read with no name, or `null` when
 * nothing that reads follows it. `end` is where the word ends, which a `toJSON(` call or the
 * `inherit` key follows.
 * @type {(text: string, end: number, at: number, syntax: typeof TIGHT, written: string, call: string | undefined) => Read}
 */
function readAt(text, end, at, syntax, written, call) {
  const named = matchAt(syntax.named, text, at);
  if (named !== null) return { name: named[1] ?? named[2] ?? named[3] ?? "" };
  const [, filter, index] = matchAt(syntax.unnamed, text, at) ?? [];
  if (filter !== undefined) return { form: `${written}.*` };
  if (index !== undefined) return { form: `${written}[…]` };
  if (call !== undefined && matchAt(CLOSES, text, end) !== null)
    return { form: `${call}(${written})` };
  if (written.toLowerCase() === "secrets" && matchAt(INHERIT, text, end) !== null)
    return { form: `${written}: inherit` };
  return null;
}

/**
 * What a context word inside a region reads: nothing when it is part of a longer name or a
 * property; otherwise the name or the form with no name that follows it past whitespace and the
 * parentheses that wrap it alone, a `(` right after a name, a `)` or a `]` opening a call instead;
 * and the bare word as a read with no name when neither does.
 * @type {(text: string, start: number, end: number, written: string, call: string | undefined) => Read}
 */
function evaluatedRead(text, start, end, written, call) {
  if (text.charAt(start - 1) === "-" || text.charAt(end) === "-") return null;
  if (text.charAt(previous(text, start)) === ".") return null;
  let wrapping = 0;
  for (let at = previous(text, start); text.charAt(at) === "("; at = previous(text, at)) {
    if (CALLER.test(text.charAt(previous(text, at)))) break;
    wrapping += 1;
  }
  let after = end;
  for (let closed = 0; closed < wrapping && text.charAt(next(text, after)) === ")"; closed += 1)
    after = next(text, after) + 1;
  return readAt(text, end, after, SPACED, written, call) ?? { form: written };
}

/**
 * The sorted, distinct names of the repository variables and secrets a workflow's text reads, and
 * each read of one of the two contexts that names nothing, in the order the text writes them.
 * @param {string} text - The workflow file's text.
 * @returns {{ vars: string[], secrets: string[], nameless: Nameless[] }} the names each context
 *   reads, and each read with no name with its line, its context and its form as written
 */
export function workflowReferences(text) {
  const regions = expressionRegions(text);
  /** @type {Record<string, Set<string>>} */
  const found = { vars: new Set(), secrets: new Set() };
  /** @type {Nameless[]} */
  const nameless = [];
  for (const match of text.matchAll(CONTEXT)) {
    const [whole, call, written = ""] = match;
    const end = match.index + whole.length;
    const start = end - written.length;
    const context = written.toLowerCase();
    const read = regions.some((region) => region.start <= start && start < region.end)
      ? evaluatedRead(text, start, end, written, call)
      : readAt(text, end, end, TIGHT, written, call);
    if (read === null) continue;
    if ("name" in read) found[context]?.add(read.name);
    else nameless.push({ line: text.slice(0, match.index).split("\n").length, context, ...read });
  }
  const sorted = (/** @type {string} */ context) => [...(found[context] ?? [])].sort();
  return { vars: sorted("vars"), secrets: sorted("secrets"), nameless };
}
