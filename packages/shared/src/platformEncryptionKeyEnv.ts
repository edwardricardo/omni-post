/**
 * @file platformEncryptionKeyEnv.ts
 * @description The env fields that configure the platform encryption key, declared once
 *   for every process that encrypts or decrypts with it. `apps/api` and `apps/workers`
 *   each spread these fields into their own env schema, so the API, which stamps every
 *   envelope it writes with the active key version, and the workers, which resolve that
 *   version to a key, read the same variables under the same rules.
 *
 *   Rotation: bump `PLATFORM_ENCRYPTION_KEY_VERSION` to N+1, set `PLATFORM_ENCRYPTION_KEY`
 *   to the new key and `PLATFORM_ENCRYPTION_KEY_V<N>` to the previous one, in the API and
 *   the workers together. New envelopes are written under the new version; an envelope
 *   stamped with an earlier version still decrypts with its `_V<N>` key, which stays set
 *   until every row stamped with that version has been rewritten under the current key.
 *
 *   Reads no env: each app's env module parses `process.env` against the schema it builds.
 *   Zod only, so the browser-loaded shared kernel stays free of Node built-ins; served from
 *   `@shared/types/platformEncryptionKeyEnv.js`, not from the root barrel.
 * @layer domain
 */
import { z } from "zod";

/**
 * @function platformEncryptionKeyEnvFields
 * @description The Zod fields of the platform encryption key: the active key, the version
 *   new envelopes are stamped with (default 1, the steady state), and the keys of versions
 *   1 to 3 kept for a rotation window.
 * @param secretMin - Minimum length of a key value: the app's own `SECRET_MIN`.
 * @returns Fields to spread into an env module's `server` schema.
 */
export function platformEncryptionKeyEnvFields(secretMin: number) {
  return {
    PLATFORM_ENCRYPTION_KEY: z.string().min(secretMin),
    PLATFORM_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    PLATFORM_ENCRYPTION_KEY_V1: z.string().min(secretMin).optional(),
    PLATFORM_ENCRYPTION_KEY_V2: z.string().min(secretMin).optional(),
    PLATFORM_ENCRYPTION_KEY_V3: z.string().min(secretMin).optional(),
  };
}
