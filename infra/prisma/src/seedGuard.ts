/**
 * @file seedGuard.ts
 * @description Decides whether the development seed may run in a given environment. The seed
 *   writes demonstration accounts whose password is in its source and an administrator whose
 *   password the developer chooses, rows only a development or test database may hold, so it runs
 *   only when `NODE_ENV` is `development` or `test`, or is unset, which counts as development; any
 *   other value is refused, so a value nobody listed fails closed. It takes no default for the
 *   administrator's password, so an `ADMIN_PASSWORD` that is absent or blank is refused by a second
 *   rule, which returns the password to use otherwise. Each decision is a pure value: the
 *   environment comes in as a parameter, nothing global is read or written, and the seed itself
 *   reports a refusal and ends the process.
 * @layer infrastructure
 */

/** The values of `NODE_ENV` under which the seed runs, as the refusal names them. */
const SEED_NODE_ENVS: ReadonlySet<string> = new Set(["development", "test"]);

/** The value an unset `NODE_ENV` counts as. */
const UNSET_NODE_ENV = "development";

/**
 * @description The reason a refused environment is given, as the seed writes it to stderr. It
 *   names the value it met, quoted so that an empty value or surrounding whitespace shows, and the
 *   values it accepts.
 * @param nodeEnv - The `NODE_ENV` that was refused
 * @returns The reason as text
 */
function refusedEnvironmentReason(nodeEnv: string): string {
  return `The development seed runs only when NODE_ENV is ${[...SEED_NODE_ENVS].join(" or ")}, or is unset: NODE_ENV is ${JSON.stringify(nodeEnv)}.`;
}

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
 * @description Returns whether the development seed may run in `environment`. It is allowed when
 *   `NODE_ENV` is exactly `development` or `test`, or is absent, which counts as development. Every
 *   other value is refused, `production`, `staging` and the empty value included, and so is a value
 *   that differs from an accepted one only by casing or surrounding whitespace.
 * @param environment - The environment to judge, such as `process.env`.
 * @returns `{ allowed: true }`, or `{ allowed: false, reason }` with the reason as text.
 */
export function evaluateSeedEnvironment(environment: SeedEnvironment): SeedVerdict {
  const nodeEnv = environment.NODE_ENV ?? UNSET_NODE_ENV;
  if (SEED_NODE_ENVS.has(nodeEnv)) {
    return { allowed: true };
  }
  return { allowed: false, reason: refusedEnvironmentReason(nodeEnv) };
}

/**
 * The reason a missing administrator password is refused, as the seed writes it to stderr. It is
 * fixed text, so it never carries the value that was refused.
 */
export const SEED_REFUSED_WITHOUT_ADMIN_PASSWORD_REASON =
  "The development seed creates an administrator and takes no default password: set ADMIN_PASSWORD in the environment or in the env file at the repository root.";

/** The variable of the environment the password rule reads. */
export interface AdminPasswordEnvironment {
  readonly ADMIN_PASSWORD?: string | undefined;
}

/** The seed may run, and creates its administrator with this password. */
export interface AdminPasswordGiven {
  readonly allowed: true;
  readonly password: string;
}

/** The password rule's verdict on one environment. */
export type AdminPasswordVerdict = AdminPasswordGiven | SeedRefused;

/**
 * @description Returns the administrator's password the development seed must use, read from
 *   `environment`. The seed creates an administrator and has no default password, so an
 *   `ADMIN_PASSWORD` that is absent, empty, or blank once trimmed is refused; any other value is
 *   returned exactly as given, surrounding whitespace included, because it is the password itself.
 * @param environment - The environment to read, such as `process.env`.
 * @returns `{ allowed: true, password }`, or `{ allowed: false, reason }` with the reason as text.
 */
export function evaluateAdminPassword(environment: AdminPasswordEnvironment): AdminPasswordVerdict {
  const password = environment.ADMIN_PASSWORD;
  if (password === undefined || password.trim() === "") {
    return { allowed: false, reason: SEED_REFUSED_WITHOUT_ADMIN_PASSWORD_REASON };
  }
  return { allowed: true, password };
}
