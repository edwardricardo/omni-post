/**
 * @file redisSubscriber.test.ts
 * @description Unit tests for `duplicateForSubscriber`, the canonical factory for
 *              Redis subscribe-mode connections. Locks the invariant that the
 *              returned connection OMITS the `commandTimeout` option entirely
 *              (never 0, never undefined-assigned) so subscribe/psubscribe never
 *              arms a per-command timer — the root cause of the spurious
 *              "Command timed out" failures under ioredis >=5.11 (homelab F-1).
 *              Also verifies host/port/db/password and lazyConnect semantics carry
 *              over from the parent connection.
 * @layer infrastructure
 */
import { describe, it, expect, afterEach } from "vitest";
import { Redis } from "ioredis";
import { duplicateForSubscriber } from "../../../src/lib/redis.js";

describe("duplicateForSubscriber", () => {
  const opened: Redis[] = [];

  const track = (conn: Redis): Redis => {
    opened.push(conn);
    return conn;
  };

  afterEach(() => {
    // lazyConnect connections never opened a socket; disconnect is a safe no-op
    // and prevents any lingering handles from failing the vitest exit check.
    for (const conn of opened.splice(0)) {
      conn.disconnect();
    }
  });

  it("returns a connection whose options omit the commandTimeout key entirely", () => {
    const parent = track(
      new Redis({
        host: "127.0.0.1",
        port: 6390,
        db: 3,
        password: "s3cr3t",
        lazyConnect: true,
        commandTimeout: 5_000,
      })
    );
    // Sanity: the parent DID carry a commandTimeout — the helper must strip it.
    expect("commandTimeout" in parent.options).toBe(true);

    const subscriber = track(duplicateForSubscriber(parent));

    expect("commandTimeout" in subscriber.options).toBe(false);
  });

  it("never re-adds commandTimeout as an undefined value (exactOptionalPropertyTypes)", () => {
    const parent = track(
      new Redis({ host: "127.0.0.1", port: 6390, lazyConnect: true, commandTimeout: 5_000 })
    );

    const subscriber = track(duplicateForSubscriber(parent));

    // Absence, not `undefined`: the key must not exist at all so ioredis'
    // `typeof options.commandTimeout === "number"` guard is never satisfied.
    expect(Object.prototype.hasOwnProperty.call(subscriber.options, "commandTimeout")).toBe(false);
    expect(subscriber.options.commandTimeout).toBeUndefined();
  });

  it("preserves host, port, db, and password from the parent connection", () => {
    const parent = track(
      new Redis({
        host: "10.0.0.5",
        port: 6399,
        db: 7,
        password: "pw-xyz",
        lazyConnect: true,
        commandTimeout: 5_000,
      })
    );

    const subscriber = track(duplicateForSubscriber(parent));

    expect(subscriber.options.host).toBe("10.0.0.5");
    expect(subscriber.options.port).toBe(6399);
    expect(subscriber.options.db).toBe(7);
    expect(subscriber.options.password).toBe("pw-xyz");
  });

  it("preserves lazyConnect semantics from the parent (no eager connection)", () => {
    const parent = track(
      new Redis({ host: "127.0.0.1", port: 6390, lazyConnect: true, commandTimeout: 5_000 })
    );

    const subscriber = track(duplicateForSubscriber(parent));

    expect(subscriber.options.lazyConnect).toBe(true);
    // A lazyConnect connection stays in "wait" until an explicit command/connect.
    expect(subscriber.status).toBe("wait");
  });

  it("returns a distinct connection instance from the parent", () => {
    const parent = track(new Redis({ host: "127.0.0.1", lazyConnect: true }));

    const subscriber = track(duplicateForSubscriber(parent));

    expect(subscriber).not.toBe(parent);
    expect(subscriber).toBeInstanceOf(Redis);
  });
});
