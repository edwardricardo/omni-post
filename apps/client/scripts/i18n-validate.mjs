/**
 * @file i18n-validate.mjs
 * @description i18n catalog linter for the client app. Complements the
 *              TypeScript type-safe-messages check (which validates t() keys)
 *              with three runtime-catalog guarantees that TS cannot express:
 *                1. Every message in es.json and en.json parses as valid ICU
 *                   MessageFormat (catches malformed plural/select/argument
 *                   syntax).
 *                2. Key parity: es and en have exactly the same key set.
 *                3. Argument parity: each message uses the same ICU
 *                   variables/placeholders in es and en (a mismatch is a
 *                   translation bug — e.g. {count} dropped in one locale).
 *              Exits non-zero with a precise report on any violation.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const here = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(here, "..", "messages");
const LOCALES = ["es", "en"];

/** Flatten a nested catalog into dot-path → string entries. */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

/** Collect the set of ICU argument names referenced by a parsed message. */
function collectArgs(ast, acc = new Set()) {
  for (const el of ast) {
    if (
      el.type === TYPE.argument ||
      el.type === TYPE.number ||
      el.type === TYPE.date ||
      el.type === TYPE.time ||
      el.type === TYPE.select ||
      el.type === TYPE.plural ||
      el.type === TYPE.pound
    ) {
      if (el.value) acc.add(el.value);
    }
    if (el.options) for (const opt of Object.values(el.options)) collectArgs(opt.value, acc);
  }
  return acc;
}

const catalogs = {};
const errors = [];

for (const locale of LOCALES) {
  const raw = JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
  const flat = flatten(raw);
  catalogs[locale] = flat;
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== "string") {
      errors.push(`[${locale}] ${key}: value is not a string`);
      continue;
    }
    try {
      parse(value);
    } catch (e) {
      errors.push(`[${locale}] ${key}: invalid ICU — ${e.message}`);
    }
  }
}

// Key parity.
const esKeys = new Set(Object.keys(catalogs.es));
const enKeys = new Set(Object.keys(catalogs.en));
for (const k of esKeys) if (!enKeys.has(k)) errors.push(`missing in en.json: ${k}`);
for (const k of enKeys) if (!esKeys.has(k)) errors.push(`missing in es.json: ${k}`);

// Argument parity (only for keys present in both).
for (const k of esKeys) {
  if (!enKeys.has(k)) continue;
  try {
    const esArgs = [...collectArgs(parse(catalogs.es[k]))].sort();
    const enArgs = [...collectArgs(parse(catalogs.en[k]))].sort();
    if (esArgs.join(",") !== enArgs.join(",")) {
      errors.push(`arg mismatch ${k}: es{${esArgs.join(",")}} vs en{${enArgs.join(",")}}`);
    }
  } catch {
    // ICU parse errors already reported above.
  }
}

const totalEs = Object.keys(catalogs.es).length;
const totalEn = Object.keys(catalogs.en).length;

if (errors.length > 0) {
  console.error(`i18n:lint FAILED — ${errors.length} issue(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`i18n:lint OK — es:${totalEs} en:${totalEn} messages, valid ICU, key + arg parity.`);
