/**
 * @file seedGuard.ts
 * @description Decides whether the development seed may run in a given environment. The seed
 *   writes demonstration accounts and an administrator with a known password, rows a production
 *   database must never hold, so a production `NODE_ENV` is refused. The decision is a pure value:
 *   the environment comes in as a parameter, nothing global is read and nothing is written, and the
 *   seed itself reports a refusal and ends the process.
 * @layer infrastructure
 */

/** The reason a production environment is refused, as the seed writes it to stderr. */
export const SEED_REFUSED_UNDER_PRODUCTION_REASON =
  "The development seed does not run under a production environment: NODE_ENV is production.";

/** The variables of the environment the guard reads. */
export interface SeedEnvironment {
  readonly NODE_ENV?: string | undefined;
}

/** The seed may run. */
export interface SeedAllowed {
  readonly allowed: true;
}

/** The seed must not run, for the stated reason. */
export interface SeedRefused {
  readonly allowed: false;
  readonly reason: string;
}

/** The guard's verdict on one environment. */
export type SeedVerdict = SeedAllowed | SeedRefused;

/**
 * @description Returns whether the development seed may run in `environment`. It is refused when
 *   `NODE_ENV`, trimmed and lower-cased, is `production`, so a value that differs only by casing or
 *   surrounding whitespace fails closed; every other value, the absent and the empty included, is
 *   allowed.
 * @param environment - The environment to judge, such as `process.env`.
 * @returns `{ allowed: true }`, or `{ allowed: false, reason }` with the reason as text.
 */
export function evaluateSeedEnvironment(environment: SeedEnvironment): SeedVerdict {
  const nodeEnv = environment.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    return { allowed: false, reason: SEED_REFUSED_UNDER_PRODUCTION_REASON };
  }
  return { allowed: true };
}
