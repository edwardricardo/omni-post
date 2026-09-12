/**
 * @file nameDigestRing.test.ts
 * @description Boot-time contract for the DeletionRecord name-digest key ring.
 *              Two halves that have to agree: the pure parser that turns the
 *              env string into `ReadonlyMap<number, Buffer>`, and the REAL
 *              `parseApiEnv` schema, driven with crafted runtime envs so the
 *              refusals proven here are the ones a deployment would actually
 *              hit rather than a reimplemented copy of the rules.
 *
 *              Every refusal must NAME the offending version. A ring is
 *              append-only and its generations outlive the plaintext they
 *              described, so "the ring is invalid" tells an operator nothing
 *              actionable at 3am — "version 2 is not 64 lowercase hex
 *              characters" does.
 *
 *              `parseApiEnv` is reached through a dynamic import with a
 *              complete env fixture already installed, because `env.ts`
 *              validates `process.env` at module load; a static import would
 *              make this suite depend on whatever the local `.env.test` holds.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { parseNameDigestKeyRing } from "../../../src/security/nameDigest/keyRing.js";

// `env.ts` calls `dotenv.config()` on import, which would re-inject `.env.test`
// over the fixture below. Neutralise it so the fixture is the only source.
vi.mock("dotenv", () => ({
  default: { config: () => ({ parsed: {} }) },
}));

/** 32 bytes of obviously-fake, deterministic key material, as 64 lowercase hex. */
const KEY_ONE = "1".repeat(64);
const KEY_TWO = "2".repeat(64);
const KEY_THREE = "3".repeat(64);

/** A valid single-generation ring. */
const RING_V1 = JSON.stringify({ 1: KEY_ONE });

/**
 * Every REQUIRED apps/api server key, so the only failure under test is the
 * ring mutation each case applies. Values are throwaway test fixtures.
 */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:password123@localhost:5432/omnipostdb",
  SHADOW_DATABASE_URL: "postgresql://postgres:password123@localhost:5432/omnipostdb_shadow",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a-very-long-jwt-access-secret-for-testing-only",
  JWT_REFRESH_SECRET: "a-very-long-jwt-refresh-secret-for-testing-only",
  CUSTOMER_JWT_SECRET: "a-very-long-customer-jwt-secret-for-testing-only",
  ADMIN_JWT_ACCESS_SECRET: "a-very-long-admin-access-secret-for-testing-only",
  ADMIN_JWT_REFRESH_SECRET: "a-very-long-admin-refresh-secret-for-testing-only",
  COOKIE_SECRET: "a-very-long-cookie-secret-for-testing-purposes-only",
  PLATFORM_ENCRYPTION_KEY: "a-very-long-platform-encryption-key-testing-only",
  OAUTH_ENCRYPTION_KEY: "a-very-long-oauth-encryption-key-for-testing-only",
  DELETION_NAME_DIGEST_KEY_RING: RING_V1,
};

/** The exported factory, loaded with `BASE_ENV` installed so module load succeeds. */
type ParseApiEnv = (runtimeEnv: Record<string, string | undefined>) => unknown;

/**
 * Load the REAL `parseApiEnv`, restoring `process.env` afterwards. The returned
 * function takes its runtime env explicitly, so it stays usable once the
 * fixture is gone.
 */
async function loadParseApiEnv(): Promise<ParseApiEnv> {
  vi.resetModules();
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV);
  try {
    const module = await import("../../../src/config/env.js");
    return module.parseApiEnv as ParseApiEnv;
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

/** Assert that a crafted env refuses to boot with `expected` in the message. */
async function assertRefusesToBoot(
  overrides: Record<string, string | undefined>,
  expected: RegExp
): Promise<void> {
  const parseApiEnv = await loadParseApiEnv();
  expect(() => parseApiEnv({ ...BASE_ENV, ...overrides })).toThrow(expected);
}

describe("parseNameDigestKeyRing", () => {
  it("parses a single generation into a map of 32-byte buffers", () => {
    const result = parseNameDigestKeyRing(RING_V1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable — asserted ok above");

    expect(result.ring.size).toBe(1);
    const key = result.ring.get(1);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(32);
    expect(key?.toString("hex")).toBe(KEY_ONE);
  });

  it("parses several generations, keyed by NUMBER rather than by string", () => {
    const result = parseNameDigestKeyRing(JSON.stringify({ 1: KEY_ONE, 2: KEY_TWO, 3: KEY_THREE }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable — asserted ok above");

    expect([...result.ring.keys()]).toEqual([1, 2, 3]);
    expect(result.ring.get(2)?.toString("hex")).toBe(KEY_TWO);
  });

  it("names the offending version when key material is malformed", () => {
    const result = parseNameDigestKeyRing(JSON.stringify({ 1: KEY_ONE, 2: "abc" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted not ok above");
    expect(result.reason).toContain("version 2");
  });
});

describe("apps/api env — the name-digest key ring is a boot-time contract", () => {
  it("accepts a well-formed ring and pointer", async () => {
    const parseApiEnv = await loadParseApiEnv();
    expect(() =>
      parseApiEnv({
        ...BASE_ENV,
        DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: KEY_ONE, 2: KEY_TWO }),
        DELETION_NAME_DIGEST_ACTIVE_VERSION: "2",
      })
    ).not.toThrow();
  });

  it("defaults the active pointer to generation 1", async () => {
    const parseApiEnv = await loadParseApiEnv();
    const parsed = parseApiEnv(BASE_ENV) as { DELETION_NAME_DIGEST_ACTIVE_VERSION: number };
    expect(parsed.DELETION_NAME_DIGEST_ACTIVE_VERSION).toBe(1);
  });

  it("refuses to boot when the ring is absent — there is no default key", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: undefined },
      /DELETION_NAME_DIGEST_KEY_RING/
    );
  });

  it("refuses to boot when the ring is an empty string", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: "" },
      /DELETION_NAME_DIGEST_KEY_RING/
    );
  });

  it("refuses to boot when the ring is not valid JSON", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: "{1:" },
      /DELETION_NAME_DIGEST_KEY_RING is not valid JSON/
    );
  });

  it("refuses to boot when the ring is JSON but not an object", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify([KEY_ONE]) },
      /must be a JSON object/
    );
  });

  it("refuses to boot when the ring holds no generation at all", async () => {
    await assertRefusesToBoot({ DELETION_NAME_DIGEST_KEY_RING: "{}" }, /version 1/);
  });

  it("refuses to boot on a non-version key, naming it", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ latest: KEY_ONE }) },
      /"latest"/
    );
  });

  it("refuses to boot on a zero or negative version, naming it", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 0: KEY_ONE }) },
      /"0"/
    );
  });

  it("refuses to boot on key material shorter than 32 bytes, naming its version", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: "1".repeat(62) }) },
      /version 1 is not 64 lowercase hex/
    );
  });

  it("refuses to boot on UPPERCASE hex, naming its version", async () => {
    // Case matters because the ring is compared and documented as lowercase
    // hex; accepting both spellings would make two env values that look
    // different produce the same key, and the runbook ambiguous.
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: KEY_ONE, 2: "A".repeat(64) }) },
      /version 2 is not 64 lowercase hex/
    );
  });

  it("refuses to boot on non-hex key material, naming its version", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: "z".repeat(64) }) },
      /version 1 is not 64 lowercase hex/
    );
  });

  it("refuses to boot on a gapped ring, naming the missing version", async () => {
    // A generation removed from the middle is the shape that would leave rows
    // pinned to it unverifiable forever, so it must never boot quietly.
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 1: KEY_ONE, 3: KEY_THREE }) },
      /is missing version 2 \(versions must be contiguous from 1\)/
    );
  });

  it("refuses to boot when generation 1 itself was removed", async () => {
    await assertRefusesToBoot(
      {
        DELETION_NAME_DIGEST_KEY_RING: JSON.stringify({ 2: KEY_TWO }),
        DELETION_NAME_DIGEST_ACTIVE_VERSION: "2",
      },
      /is missing version 1 \(versions must be contiguous from 1\)/
    );
  });

  it("refuses to boot when the pointer names a version the ring lacks", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_ACTIVE_VERSION: "2" },
      /DELETION_NAME_DIGEST_ACTIVE_VERSION=2 names no ring entry/
    );
  });

  it("refuses to boot on a pointer below 1", async () => {
    await assertRefusesToBoot(
      { DELETION_NAME_DIGEST_ACTIVE_VERSION: "0" },
      /DELETION_NAME_DIGEST_ACTIVE_VERSION/
    );
  });

  it("never reuses PLATFORM_ENCRYPTION_KEY as the digest key", async () => {
    // The ring is a MAC key ring with its own custody and its own rotation
    // shape (append, never re-wrap). Sharing the platform KEK would tie two
    // rotations together and put one key under two unrelated threat models.
    const parseApiEnv = await loadParseApiEnv();
    const parsed = parseApiEnv(BASE_ENV) as {
      DELETION_NAME_DIGEST_KEY_RING: string;
      PLATFORM_ENCRYPTION_KEY: string;
    };
    expect(parsed.DELETION_NAME_DIGEST_KEY_RING).not.toContain(parsed.PLATFORM_ENCRYPTION_KEY);
  });
});
