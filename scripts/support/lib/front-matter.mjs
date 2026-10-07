// @ts-check
/**
 * @file front-matter.mjs
 * @description The front-matter library of the support documentation generators: a flat grammar
 *   read without a YAML library (`key: value`, or `key:` followed by `  - item` or `  key: value`
 *   lines, with quoted values and `#` comments; any other line is refused with its number), the
 *   `## ` headings of a body outside code fences, and the generic checks a support doc's front
 *   matter and headings are held to: the key set, the heading order, a repository path, a
 *   `YYYY-MM-DD` date and a 40-hex commit sha.
 * @layer infrastructure
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

/** @typedef {string | string[] | Record<string, string>} Value */

/** @type {(raw: string) => string} a value without its quotes or its trailing comment */
const scalar = (raw) => {
  const quoted = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(raw.trim());
  return quoted === null ? raw.replace(/(?:^|\s)#.*$/, "").trim() : (quoted[2] ?? "");
};

/**
 * Splits a document into its front matter, read by the flat grammar, and its body lines. A
 * problem names the file and, for a line of the front matter, its line number.
 * @type {(file: string, text: string) => { data: Map<string, Value>, body: string[], problems: string[] }}
 */
export function parseFrontMatter(file, text) {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  const data = /** @type {Map<string, Value>} */ (new Map());
  if (lines[0] !== "---" || end === -1) {
    return { data, body: lines, problems: [`${file}: no front matter between two --- lines`] };
  }
  const problems = /** @type {string[]} */ ([]);
  let key = "";
  /** @type {string[] | Record<string, string> | null} */
  let open = null;
  for (const [index, line] of lines.slice(1, end).entries()) {
    const [top, item, sub] = [/^([a-z]+):(.*)$/, /^\s+- (.*)$/, /^\s+([a-z]+):(.*)$/].map((re) =>
      re.exec(line)
    );
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (top) {
      key = top[1] ?? "";
      if (data.has(key)) problems.push(`${file}:${index + 2}: ${key} is set twice`);
      open = scalar(top[2] ?? "") === "" ? [] : null;
      data.set(key, open ?? scalar(top[2] ?? ""));
    } else if (item && Array.isArray(open)) open.push(scalar(item[1] ?? ""));
    else if (sub && open !== null && !(Array.isArray(open) && open.length > 0)) {
      if (Array.isArray(open)) data.set(key, (open = {}));
      open[sub[1] ?? ""] = scalar(sub[2] ?? "");
    } else problems.push(`${file}:${index + 2}: no "key: value", "  - item" or "  key: value"`);
  }
  return { data, body: lines.slice(end + 1), problems };
}

/** @type {(lines: string[]) => Array<{ title: string, index: number }>} the `## ` headings outside fences */
export function headingsOf(lines) {
  let fenced = false;
  return lines.flatMap((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const found = fenced ? null : /^## +(.*?)\s*$/.exec(line);
    return found === null ? [] : [{ title: found[1] ?? "", index }];
  });
}

/** @type {(titles: string[], expected: readonly string[]) => string | null} where the headings first differ */
export function sectionProblem(titles, expected) {
  const at = [...expected, ...titles].findIndex((_, i) => titles[i] !== expected[i]);
  const q = (/** @type {string | undefined} */ title) => (title ? `"## ${title}"` : "none");
  return at === -1 ? null : `heading ${at + 1} must be ${q(expected[at])}, not ${q(titles[at])}`;
}

/** @type {(keys: Iterable<string>, expected: readonly string[]) => string[]} the missing keys, then the unknown ones */
export function keyProblems(keys, expected) {
  const present = [...keys];
  const missing = expected.filter((key) => !present.includes(key));
  const unknown = present.filter((key) => !expected.includes(key));
  return [
    ...missing.map((key) => `front matter has no ${key}`),
    ...unknown.map((key) => `${key} is no template key`),
  ];
}

/** @type {(root: string, entry: string) => string | null} why a repository path entry is refused */
export function pathProblem(root, entry) {
  const parts = entry.replace(/\/$/, "").split("/");
  if (path.isAbsolute(entry) || /[*?[\]{}\\]/.test(entry) || parts.some((p) => /^\.{0,2}$/.test(p)))
    return `${entry} is no repository-relative path without globs`;
  // A file named with a trailing slash does not exist, so only a directory can be misnamed.
  if (!existsSync(path.join(root, entry))) return `${entry} does not exist`;
  const directory = statSync(path.join(root, entry)).isDirectory();
  return directory && !entry.endsWith("/") ? `${entry} is a directory: end it with /` : null;
}

/** @type {(d: string) => boolean} whether a value is a real `YYYY-MM-DD` date; `toJSON` is null when invalid */
export const isIsoDate = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && String(new Date(`${d}T00:00:00Z`).toJSON()).startsWith(d);

/** @type {(sha: string) => boolean} whether a value is a full 40-hex commit sha */
export const isCommitSha = (sha) => /^[0-9a-f]{40}$/.test(sha);
