/**
 * @file metrics.ts
 * @description Reads a named regular-expression literal out of `scripts/testing/metrics.mjs`,
 *              the script that defines metrics M1 and M8. That script runs on import, so the
 *              self-tests hold the engine's expressions equal to its source text instead of
 *              importing it.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** The repository this package sits in, four directories above this file. */
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** A plain JavaScript identifier: the only kind of name that is safe to interpolate below. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Reads the literal of a `const <name> = /<pattern>/<flags>;` line. The pattern and the flags are
 * both returned, so a pin compares the whole literal: a flag written on one side only would
 * otherwise pass on the pattern alone and still match differently.
 *
 * @param name - The constant's name. It must be a plain identifier, because it is interpolated
 *   into a regular expression; any other name returns `undefined` instead of being matched.
 * @returns The literal's pattern and flags, or `undefined` when no such line exists.
 */
export function metricsExpression(name: string): Pick<RegExp, "source" | "flags"> | undefined {
  if (!IDENTIFIER.test(name)) return undefined;
  const metrics = readFileSync(path.join(REPOSITORY_ROOT, "scripts/testing/metrics.mjs"), "utf8");
  const match = new RegExp(`^const ${name} = /(.+)/([a-z]*);$`, "m").exec(metrics);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { source: match[1], flags: match[2] };
}
