/**
 * @file workflowYaml.test-helpers.ts
 * @description The reader the suites of `tests/unit/scripts/` use to read a workflow, a composite
 *   action or the compose file, because a YAML parser is not a declared dependency of the root or
 *   of this package. It is line-based. What it understands: block mappings and block sequences
 *   nested by indentation, plain and single-line quoted scalars, plain scalars that continue on
 *   more-indented lines, and `|` / `>` block scalars, whose lines are returned with their line
 *   breaks kept (folding is not applied; the suites only look for text). Comment and blank lines
 *   are skipped outside block scalars. What it refuses, as a thrown error rather than an empty
 *   value: a key declared twice in one mapping, an entry that is neither `key: value` nor `- `
 *   where one is expected, a dedent that matches no enclosing level, and, for the values a suite
 *   reads, flow collections, anchors, aliases, tags and quoted scalars that span lines. Values are
 *   parsed only when a suite asks for them, so a flow sequence elsewhere in a file
 *   (`branches: [main]`) is never read. Escapes inside double quotes are not interpreted.
 * @layer infrastructure
 */

/** One `key: value` entry of a block mapping, its value left unparsed until a check asks. */
export interface MappingEntry {
  /** Where the entry sits, for the failure message. */
  readonly where: string;
  /** The text after `key:` on the key's own line. */
  readonly inline: string;
  /** The lines after the key's line that belong to its value. */
  readonly body: readonly string[];
}

export type Mapping = ReadonlyMap<string, MappingEntry>;

const KEY_LINE = /^(\s*)("[^"]*"|'[^']*'|[^\s#"'[{&*!?|>%@`-][^:#]*?)\s*:(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^[|>][1-9+-]{0,2}\s*(?:#.*)?$/;

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === "";

/**
 * @description Tells a line that holds YAML structure from a blank line or a comment.
 * @param line - One line of the file.
 * @returns Whether the line holds YAML structure: neither blank nor a comment.
 */
export const isStructural = (line: string): boolean =>
  !isBlank(line) && !line.trimStart().startsWith("#");

/**
 * @description Reads the block mapping held by `lines`, at the indentation of its first
 *   structural line.
 * @param lines - The mapping's lines; blank and comment lines may sit anywhere.
 * @param where - A label for failure messages.
 * @returns Every key of the mapping, each declared exactly once.
 */
export function readMapping(lines: readonly string[], where: string): Mapping {
  const first = lines.find(isStructural);
  if (first === undefined) throw new Error(`${where}: the mapping is empty`);
  const level = indentOf(first);
  const entries = new Map<string, MappingEntry>();

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!isStructural(line)) {
      index += 1;
      continue;
    }
    if (indentOf(line) !== level) {
      throw new Error(`${where}: "${line.trim()}" matches no enclosing indentation level`);
    }
    const match = KEY_LINE.exec(line);
    if (match === null) throw new Error(`${where}: "${line.trim()}" is not a "key: value" entry`);
    const key = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (entries.has(key)) throw new Error(`${where}: "${key}" is declared twice in one mapping`);

    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end] ?? "";
      if (isStructural(next) && indentOf(next) <= level) break;
      end += 1;
    }
    entries.set(key, {
      where: `${where} > ${key}`,
      inline: match[3] ?? "",
      body: lines.slice(index + 1, end),
    });
    index = end;
  }
  return entries;
}

/**
 * @description Splits the block sequence held by `lines` into its entries, each rewritten as the
 *   block mapping it holds (the `- ` becomes indentation), so an entry may begin with any key or
 *   with none.
 * @param lines - The sequence's lines.
 * @param where - A label for failure messages.
 * @returns One array of lines per entry, in order.
 */
export function readSequence(lines: readonly string[], where: string): string[][] {
  const first = lines.find(isStructural);
  if (first === undefined) return [];
  const level = indentOf(first);
  const entries: string[][] = [];

  for (const line of lines) {
    if (isStructural(line) && indentOf(line) < level) {
      throw new Error(`${where}: "${line.trim()}" matches no enclosing indentation level`);
    }
    if (isStructural(line) && indentOf(line) === level) {
      if (!/^-(\s|$)/.test(line.trimStart())) {
        throw new Error(`${where}: "${line.trim()}" is not a "- " sequence entry`);
      }
      entries.push([`${line.slice(0, level)} ${line.slice(level + 1)}`]);
      continue;
    }
    entries.at(-1)?.push(line);
  }
  return entries;
}

/**
 * @description The lines nested under a key whose value is a block collection.
 * @param mapping - The mapping holding the key.
 * @param key - The key to read.
 * @returns The value's lines.
 */
export function collectionOf(mapping: Mapping, key: string): readonly string[] {
  const entry = mapping.get(key);
  if (entry === undefined) throw new Error(`"${key}" is not declared`);
  if (entry.inline.replace(/\s*#.*$/, "") !== "" || !entry.body.some(isStructural)) {
    throw new Error(`${entry.where}: the value is not a block collection`);
  }
  return entry.body;
}

/**
 * @description The whole scalar value of a key: inline, continued on more-indented lines, or a
 *   block scalar.
 * @param mapping - The mapping holding the key.
 * @param key - The key to read.
 * @returns The value with surrounding quotes removed; `undefined` when the key is not declared.
 */
export function scalarOf(mapping: Mapping, key: string): string | undefined {
  const entry = mapping.get(key);
  if (entry === undefined) return undefined;
  const { where, inline, body } = entry;

  if (BLOCK_SCALAR.test(inline)) {
    const level = indentOf(body.find((line) => !isBlank(line)) ?? "");
    const end = body.findIndex((line) => !isBlank(line) && indentOf(line) < level);
    const content = (end === -1 ? body : body.slice(0, end)).map((line) => line.slice(level));
    return content.join("\n").trimEnd();
  }
  if (/^[[{&*!?%@`]/.test(inline)) {
    throw new Error(`${where}: flow collections, anchors, aliases and tags are not read`);
  }

  const continuation = body.filter(isStructural).map((line) => line.trim());
  if (/^["']/.test(inline)) {
    const quoted = /^("((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')\s*(?:#.*)?$/.exec(inline);
    if (quoted === null || continuation.length > 0) {
      throw new Error(`${where}: a quoted scalar that spans lines is not read`);
    }
    return quoted[2] ?? (quoted[3] ?? "").replaceAll("''", "'");
  }
  if (
    inline === "" &&
    continuation.length > 0 &&
    /^(-(\s|$)|[^\s:]+:(\s|$))/.test(continuation[0] ?? "")
  ) {
    throw new Error(`${where}: the value is a collection, not a scalar`);
  }
  return [inline.replace(/\s+#.*$/, ""), ...continuation].filter((part) => part !== "").join(" ");
}
