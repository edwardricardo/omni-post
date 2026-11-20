/**
 * @file bruteForceDefaults.ts
 * @description The default duration of the lock that failed sign-ins set, which
 *   `RedisBruteForceAdapter` applies when it is given no configuration and the first-administrator
 *   command states. It lives in a module that imports nothing, so the command can read it without
 *   loading the adapter's logger, the API's environment or a Redis client.
 * @layer infrastructure
 */

/** How long a lock that failed sign-ins set lasts, in minutes, when nothing configures it. */
export const DEFAULT_LOCKOUT_DURATION_MINUTES = 30;
