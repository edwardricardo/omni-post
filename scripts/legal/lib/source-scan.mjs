// @ts-check
/**
 * @file source-scan.mjs
 * @description The source scanner of the legal inventory generators: it lists the source files
 *   under a set of roots, finds the call sites of a set of matchers, resolves an argument to the
 *   string its own file states, and reads the names a file binds to a call and the entries of an
 *   object-literal argument. Comments are blanked first, so a call named in prose is no site. It
 *   is textual, not a parser: a regex literal holding `//` blanks the rest of its line, and a name
 *   imported from another file stays unresolved for the generator to refuse.
 * @layer infrastructure
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SOURCE_EXTENSIONS = Object.freeze([".ts", ".tsx", ".mjs", ".js"]);
const SKIPPED_DIRS = new Set("node_modules dist .next .turbo coverage tests __tests__".split(" "));
/** Tests, specs, stories, declaration files and every `.env*` file are never read. */
const SKIPPED_FILE = /\.(?:test|spec|stories)\.|\.d\.[cm]?ts$|^\.env/;
const QUOTES = "\"'`";
/** A string literal; a template only when it interpolates nothing. Groups 1-3 hold the value. */
const LITERAL = String.raw`(?:"([^"\\\n]*)"|'([^'\\\n]*)'|\x60([^\x60$\\]*)\x60)`;

/** @typedef {{ name: string, pattern: RegExp }} Matcher */
/** @typedef {{ file: string, line: number, matcher: string, args: string[] }} Site */

/**
 * The sorted repo-relative POSIX paths of the source files under `roots`, a root being a directory
 * or one file, and the roots that do not exist, so the caller fails closed instead of scanning less.
 * @type {(root: string, options: { roots: readonly string[], extensions?: readonly string[] }) => { files: string[], missing: string[] }}
 */
export function listSourceFiles(root, { roots, extensions = SOURCE_EXTENSIONS }) {
  /** @type {string[]} */
  const files = [];
  /** @type {(name: string) => boolean} */
  const isSource = (name) => extensions.includes(path.extname(name)) && !SKIPPED_FILE.test(name);
  /** @type {(dir: string) => void} */
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = path.posix.join(dir, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) walk(file);
      if (entry.isFile() && isSource(entry.name)) files.push(file);
    }
  };
  const missing = roots.filter((dir) => !existsSync(path.join(root, dir)));
  for (const start of roots.filter((dir) => !missing.includes(dir))) {
    if (statSync(path.join(root, start)).isDirectory()) walk(start);
    else if (isSource(path.basename(start))) files.push(start);
  }
  return { files: [...new Set(files)].sort(), missing };
}

/**
 * Replaces every comment with spaces and keeps each newline, so offsets and line numbers survive.
 * @type {(text: string) => string}
 */
export function blankComments(text) {
  const out = text.split("");
  let quote = "";
  for (let i = 0; i < out.length; i += 1) {
    const [c, next] = [out[i] ?? "", out[i + 1]];
    if (quote !== "") {
      if (c === "\\") i += 1;
      else if (c === quote || (c === "\n" && quote !== "`")) quote = "";
    } else if (QUOTES.includes(c)) quote = c;
    else if (c === "/" && (next === "/" || next === "*")) {
      const found = text.indexOf(next === "/" ? "\n" : "*/", i + 2);
      const end = found === -1 ? text.length : found + (next === "*" ? 2 : 0);
      for (; i < end; i += 1) if (out[i] !== "\n") out[i] = " ";
      i -= 1;
    }
  }
  return out.join("");
}

/**
 * Splits the text after an opening bracket at its top-level commas, up to the matching closing
 * bracket; strings and nested brackets stay whole, and whitespace collapses to one space.
 * @type {(code: string, start: number) => string[]}
 */
export function splitArguments(code, start) {
  /** @type {string[]} */
  const args = [];
  let [current, depth, quote] = ["", 0, ""];
  for (let i = start; i < code.length && depth >= 0; i += 1) {
    const c = code.charAt(i);
    if (quote !== "" && c === "\\") {
      current += c + code.charAt(i + 1);
      i += 1;
      continue;
    }
    if (quote !== "") quote = c === quote ? "" : quote;
    else if (QUOTES.includes(c)) quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    if (depth < 0 || (c === "," && depth === 0 && quote === "")) {
      args.push(current);
      current = "";
    } else current += c;
  }
  if (depth >= 0) args.push(current);
  return args.map((arg) => arg.replace(/\s+/g, " ").trim()).filter((arg) => arg !== "");
}

/**
 * Every site of every matcher. A pattern ending at a call's `(` yields its arguments, over any
 * number of lines; one ending at an `=` yields the rest of that line. `line` is where it starts.
 * @type {(file: string, text: string, matchers: readonly Matcher[]) => Site[]}
 */
export function scanFile(file, text, matchers) {
  const code = blankComments(text);
  /** @type {(matcher: Matcher) => Site[]} */
  const sitesOf = ({ name, pattern }) => {
    const all = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
    return [...code.matchAll(all)].map((match) => {
      const [at, end] = [match.index ?? 0, (match.index ?? 0) + match[0].length];
      const assigned = (code.slice(end).split("\n")[0] ?? "").replace(/;\s*$/, "").trim();
      const args = match[0].endsWith("(") ? splitArguments(code, end) : [assigned];
      return { file, line: code.slice(0, at).split("\n").length, matcher: name, args };
    });
  };
  return matchers.flatMap(sitesOf).sort((a, b) => a.line - b.line);
}

/**
 * The names a file binds to a no-argument call of `callee`, awaited or not, such as `store` in
 * `const store = await cookies()`, so a generator can match the methods called through them.
 * @type {(text: string, callee: string) => string[]}
 */
export function bindingsOf(text, callee) {
  const name = String.raw`([A-Za-z_$][\w$]*)`;
  const bound = String.raw`\b(?:const|let)\s+${name}\s*=\s*(?:await\s+)?${callee}\(\)`;
  return [...blankComments(text).matchAll(new RegExp(bound, "g"))].map(([, found = ""]) => found);
}

/**
 * The top-level entries of an object-literal argument, as written, whose key is one of `keys`,
 * plus its spreads; an argument that is no object literal yields none.
 * @type {(arg: string, keys: readonly string[]) => string[]}
 */
export function objectEntries(arg, keys) {
  const wanted = new RegExp(String.raw`^(?:\.\.\.|(?:${keys.join("|")})\s*:)`);
  return arg.startsWith("{") ? splitArguments(arg, 1).filter((entry) => wanted.test(entry)) : [];
}

/**
 * The string an argument names in its own file: a literal, or a `const` declared once whose value
 * is a literal (`as const` included), or a top-level member of a `const` object literal declared
 * once. Anything else, an import or an interpolating template, is `null`.
 * @type {(text: string, arg: string) => string | null}
 */
export function resolveStringArgument(text, arg) {
  /** @type {(match: RegExpExecArray | null) => string | null} */
  const valueOf = (match) => (match === null ? null : (match[1] ?? match[2] ?? match[3] ?? null));
  const literal = new RegExp(`^${LITERAL}$`).exec(arg.trim());
  const reference = /^([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?$/.exec(arg.trim());
  if (literal !== null || reference === null) return valueOf(literal);
  const [name = "", member] = reference.slice(1).map((part) => part?.replaceAll("$", "\\$"));
  const code = blankComments(text);
  const declared = new RegExp(String.raw`(?<![\w$.])const\s+${name}\s*(?::[^=]+)?=\s*`, "g");
  const [declaration, ...others] = [...code.matchAll(declared)];
  if (declaration === undefined || others.length > 0) return null;
  const rest = code.slice((declaration.index ?? 0) + declaration[0].length);
  if (member === undefined) {
    return valueOf(new RegExp(String.raw`^${LITERAL}\s*(?:as\s+const\b)?\s*(?:;|\n|$)`).exec(rest));
  }
  if (!rest.startsWith("{")) return null;
  const property = new RegExp(String.raw`^(?:${member}|"${member}"|'${member}')\s*:\s*${LITERAL}$`);
  const found = splitArguments(rest, 1).find((entry) => property.test(entry));
  return found === undefined ? null : valueOf(property.exec(found));
}
