/**
 * @file seedGuard.ts
 * @description Decides whether the development seed may run in a given environment. The seed
 *   writes demonstration accounts whose password is in its source and an administrator whose
 *   password the developer chooses, rows a production database must never hold, so a production
 *   `NODE_ENV` is refused. It takes no default for the administrator's password, so an
 *   `ADMIN_PASSWORD` that is absent or blank is refused by a second rule, which returns the password
 *   to use otherwise. Each decision is a pure value: the environment comes in as a parameter,
 *   nothing global is read or written, and the seed itself reports a refusal and ends the process.
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
