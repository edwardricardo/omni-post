/**
 * @file ThrottledDeletedAccountNoticeMailer.test.ts
 * @description Unit tests for the decorator that lets at most one deleted-account notice per
 *              address through per window: the first notice is sent, a repeat inside the window
 *              is not, another address is, the end of the window lets the address through
 *              again, a cache that cannot be read or written sends nothing, and no cache key
 *              carries the address.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ok, err } from "@shared/types";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import type { DeletedAccountNoticeMailer } from "@core/domain/repositories/DeletedAccountNoticeMailer.js";
import {
  DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS,
  ThrottledDeletedAccountNoticeMailer,
} from "../../../../src/infrastructure/adapters/ThrottledDeletedAccountNoticeMailer.js";

const ADDRESS = "former.owner@example.test";
const OTHER_ADDRESS = "another.owner@example.test";
const NOTICE = { supportEmail: "help@example.test" };
const WINDOW_MS = DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS * 1000;

/** The claim key the decorator is expected to write for an address. */
const claimKeyFor = (address: string): string =>
  `deleted-account-notice:${createHash("sha256").update(address).digest("hex")}`;

/** The wrapped mailer, answering ok unless a test says otherwise. */
function makeInnerMailer() {
  return {
    notifyRegistrationAttemptOnDeletedAccount: vi
      .fn<DeletedAccountNoticeMailer["notifyRegistrationAttemptOnDeletedAccount"]>()
      .mockResolvedValue(ok(undefined)),
  };
}

describe("ThrottledDeletedAccountNoticeMailer", () => {
  let cache: InMemoryCacheAdapter;
  let inner: ReturnType<typeof makeInnerMailer>;
  let mailer: ThrottledDeletedAccountNoticeMailer;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T00:00:00.000Z"));
    cache = new InMemoryCacheAdapter();
    inner = makeInnerMailer();
    mailer = new ThrottledDeletedAccountNoticeMailer(inner, cache);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends the first notice to an address", async () => {
    const result = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.deepStrictEqual(result, ok(undefined));
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledExactlyOnceWith(
      ADDRESS,
      NOTICE
    );
  });

  it("answers ok without sending a repeat notice to the same address inside the window", async () => {
    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);
    vi.setSystemTime(Date.now() + WINDOW_MS - 1);

    const repeat = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.deepStrictEqual(repeat, ok(undefined));
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(1);
  });

  it("sends a notice to another address inside the window of the first", async () => {
    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    const other = await mailer.notifyRegistrationAttemptOnDeletedAccount(OTHER_ADDRESS, NOTICE);

    assert.deepStrictEqual(other, ok(undefined));
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(2);
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenLastCalledWith(
      OTHER_ADDRESS,
      NOTICE
    );
  });

  it("sends to the address again once the window has passed", async () => {
    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);
    vi.setSystemTime(Date.now() + WINDOW_MS);

    const afterWindow = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.deepStrictEqual(afterWindow, ok(undefined));
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(2);
  });

  it("claims the address for the whole window before the notice is sent", async () => {
    const set = vi.spyOn(cache, "set");
    inner.notifyRegistrationAttemptOnDeletedAccount.mockImplementation(async () => {
      assert.equal(await cache.has(claimKeyFor(ADDRESS)), true, "claimed before the send");
      return ok(undefined);
    });

    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledExactlyOnceWith(claimKeyFor(ADDRESS), true, {
      ttlSeconds: DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS,
    });
  });

  it("returns the wrapped mailer's failure unchanged, and keeps the address claimed", async () => {
    const failure = err(new Error("transport down"));
    inner.notifyRegistrationAttemptOnDeletedAccount.mockResolvedValueOnce(failure);

    const first = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);
    const repeat = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.strictEqual(first, failure);
    assert.deepStrictEqual(repeat, ok(undefined));
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and returns an error when the cache cannot be read", async () => {
    vi.spyOn(cache, "has").mockRejectedValue(new Error("cache unreachable"));

    const result = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.equal(result.ok, false);
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).not.toHaveBeenCalled();
  });

  it("sends nothing and returns an error when the claim cannot be written", async () => {
    vi.spyOn(cache, "set").mockRejectedValue(new Error("cache unreachable"));

    const result = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.equal(result.ok, false);
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).not.toHaveBeenCalled();
  });

  it("returns an error that does not carry the address when the cache fails", async () => {
    vi.spyOn(cache, "has").mockRejectedValue(new Error("cache unreachable"));

    const result = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.ok(!result.ok);
    expect(result.error.message).not.toContain(ADDRESS);
  });

  it("keys the claim on a SHA-256 of the address, never on the address itself", async () => {
    const has = vi.spyOn(cache, "has");
    const set = vi.spyOn(cache, "set");

    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    const keys = [...has.mock.calls, ...set.mock.calls].map(([key]) => key);
    assert.deepStrictEqual(new Set(keys), new Set([claimKeyFor(ADDRESS)]));
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain(ADDRESS);
      expect(key.toLowerCase()).not.toContain("former.owner");
    }
  });
});
