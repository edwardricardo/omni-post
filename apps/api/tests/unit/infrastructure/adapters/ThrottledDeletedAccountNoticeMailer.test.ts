/**
 * @file ThrottledDeletedAccountNoticeMailer.test.ts
 * @description Unit tests for the decorator that lets at most one deleted-account notice per
 *              address through per window: the first notice is sent, a repeat inside the window
 *              is not, concurrent attempts on one address send once, another address is sent to,
 *              the end of the window lets the address through again, a claim the cache cannot
 *              decide sends nothing, and no cache key carries the address.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ok, err } from "@shared/types";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import type { DeletedAccountNoticeMailer } from "@core/domain/repositories/DeletedAccountNoticeMailer.js";
import {
  DELETED_ACCOUNT_NOTICE_CLAIM_KEY_PREFIX,
  DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS,
  ThrottledDeletedAccountNoticeMailer,
} from "../../../../src/infrastructure/adapters/ThrottledDeletedAccountNoticeMailer.js";

const ADDRESS = "former.owner@example.test";
const OTHER_ADDRESS = "another.owner@example.test";
const NOTICE = { supportEmail: "help@example.test" };
const WINDOW_MS = DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS * 1000;
const CONCURRENT_ATTEMPTS = 10;

/** The claim key the decorator is expected to use for an address: the prefix and a SHA-256. */
const claimKeyFor = (address: string): string =>
  `${DELETED_ACCOUNT_NOTICE_CLAIM_KEY_PREFIX}${createHash("sha256").update(address).digest("hex")}`;

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
    cache.close();
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

  it("sends exactly one notice when attempts on one address arrive concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_ATTEMPTS }, () =>
        mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE)
      )
    );

    for (const result of results) {
      assert.deepStrictEqual(result, ok(undefined));
    }
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

  it("sends to the address again once the cache reports the window over", async () => {
    const claim = vi.spyOn(cache, "claim");
    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);
    vi.setSystemTime(Date.now() + WINDOW_MS);
    assert.equal(await cache.has(claimKeyFor(ADDRESS)), false, "the cache no longer holds it");

    const afterWindow = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.deepStrictEqual(afterWindow, ok(undefined));
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledTimes(2);
    await expect(claim.mock.results[1]?.value).resolves.toBe(true);
    assert.equal(await cache.has(claimKeyFor(ADDRESS)), true, "the new send holds it again");
  });

  it("claims the address for the whole window before the notice is sent", async () => {
    const claim = vi.spyOn(cache, "claim");
    inner.notifyRegistrationAttemptOnDeletedAccount.mockImplementation(async () => {
      assert.equal(await cache.has(claimKeyFor(ADDRESS)), true, "claimed before the send");
      return ok(undefined);
    });

    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    expect(inner.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledExactlyOnceWith(
      claimKeyFor(ADDRESS),
      DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS
    );
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

  it("sends nothing and returns an error when the cache cannot decide the claim", async () => {
    const outage = new Error("cache unreachable");
    vi.spyOn(cache, "claim").mockRejectedValue(outage);

    const result = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.ok(!result.ok);
    assert.strictEqual(result.error.cause, outage);
    expect(inner.notifyRegistrationAttemptOnDeletedAccount).not.toHaveBeenCalled();
  });

  it("returns an error that does not carry the address when the claim fails", async () => {
    vi.spyOn(cache, "claim").mockRejectedValue(new Error("cache unreachable"));

    const result = await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    assert.ok(!result.ok);
    expect(result.error.message).not.toContain(ADDRESS);
  });

  it("keys the claim on a SHA-256 of the address, never on the address itself", async () => {
    const claim = vi.spyOn(cache, "claim");

    await mailer.notifyRegistrationAttemptOnDeletedAccount(ADDRESS, NOTICE);

    const keys = claim.mock.calls.map(([key]) => key);
    assert.deepStrictEqual(keys, [claimKeyFor(ADDRESS)]);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain(ADDRESS);
      expect(key.toLowerCase()).not.toContain("former.owner");
    }
  });
});
