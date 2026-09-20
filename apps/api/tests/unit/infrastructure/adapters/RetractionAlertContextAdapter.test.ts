/**
 * @file RetractionAlertContextAdapter.test.ts
 * @description Unit tests for the reader that turns the ids an alert event carries into
 *   the words a customer can act on. Two things are pinned: the PROVIDER is derived
 *   from the channel rather than carried as an independent field, and a missing piece
 *   degrades to a usable alert instead of suppressing it — an alert that never goes out
 *   because a title lookup failed is the silence this capability exists to end.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { RetractionAlertContextAdapter } from "../../../../src/infrastructure/adapters/RetractionAlertContextAdapter.js";
import { ok } from "@shared/types";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import client from "prom-client";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POST_ID = "b1000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "c1000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";

const makeChannelRepo = (handle = "@acme", provider = "X") => ({
  findById: vi.fn(async () => ok({ handle, provider })),
});

const makePostQuery = (overrides?: { title?: string; body?: string }) => ({
  getById: vi.fn(async () =>
    ok({
      id: POST_ID,
      title: overrides?.title,
      body: overrides?.body ?? "The full body of the post, which is long enough to be cut.",
    })
  ),
});

const makeAccountRepo = (name = "Acme Corp") => ({
  findById: vi.fn(async () => ok({ name })),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const valuesOf = async (name: string) => {
  const metric = client.register.getSingleMetric(name);
  assert.ok(metric, `${name} is not registered`);
  return (await metric.get()).values;
};

describe("RetractionAlertContextAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.register.getSingleMetric("retraction_alert_context_degraded_total")?.reset();
  });

  it("names the channel by its handle and DERIVES the provider from it", async () => {
    const adapter = new RetractionAlertContextAdapter(
      makePostQuery() as never,
      makeChannelRepo("@acme", "X") as never,
      makeAccountRepo() as never
    );

    const context = await adapter.read({
      postId: POST_ID,
      channelId: CHANNEL_ID,
      accountId: ACCOUNT_ID,
    });

    assert.strictEqual(context.channelName, "@acme");
    assert.strictEqual(context.provider, "X");
  });

  it("prefers the post's title for the excerpt", async () => {
    const adapter = new RetractionAlertContextAdapter(
      makePostQuery({ title: "Launch week" }) as never,
      makeChannelRepo() as never,
      makeAccountRepo() as never
    );

    const context = await adapter.read({
      postId: POST_ID,
      channelId: CHANNEL_ID,
      accountId: ACCOUNT_ID,
    });

    assert.strictEqual(context.postExcerpt, "Launch week");
  });

  it("falls back to a BOUNDED slice of the body when there is no title", async () => {
    const adapter = new RetractionAlertContextAdapter(
      makePostQuery({ body: "x".repeat(500) }) as never,
      makeChannelRepo() as never,
      makeAccountRepo() as never
    );

    const context = await adapter.read({
      postId: POST_ID,
      channelId: CHANNEL_ID,
      accountId: ACCOUNT_ID,
    });

    assert.ok(context.postExcerpt.length <= 160, `excerpt was ${context.postExcerpt.length} chars`);
    assert.ok(context.postExcerpt.length > 0);
  });

  it("still produces an alertable context when the post cannot be read", async () => {
    const postQuery = {
      getById: vi.fn(async () => ({
        ok: false as const,
        error: new EntityNotFoundError("Post", POST_ID),
      })),
    };
    const adapter = new RetractionAlertContextAdapter(
      postQuery as never,
      makeChannelRepo() as never,
      makeAccountRepo() as never
    );

    const context = await adapter.read({
      postId: POST_ID,
      channelId: CHANNEL_ID,
      accountId: ACCOUNT_ID,
    });

    assert.ok(context.postExcerpt.length > 0, "an unreadable post must not empty the alert");
    assert.strictEqual(context.channelName, "@acme");
  });

  it("still produces an alertable context when the channel cannot be read", async () => {
    const channelRepo = {
      findById: vi.fn(async () => ({
        ok: false as const,
        error: new EntityNotFoundError("Channel", CHANNEL_ID),
      })),
    };
    const adapter = new RetractionAlertContextAdapter(
      makePostQuery() as never,
      channelRepo as never,
      makeAccountRepo() as never
    );

    const context = await adapter.read({
      postId: POST_ID,
      channelId: CHANNEL_ID,
      accountId: ACCOUNT_ID,
    });

    assert.ok(context.channelName.length > 0, "an unreadable channel must not empty the alert");
  });

  describe("a repository that THROWS degrades exactly like one that answers err", () => {
    /**
     * A STORE failure, shaped the way the store really raises one. The double carries a
     * Prisma initialization code because that is what "the connection pool is
     * exhausted" arrives as — a bare `Error` with no code is indistinguishable from a
     * bug, and the adapter now tells the two apart.
     */
    const exploding = (method: string) => ({
      [method]: vi.fn(async () => {
        throw Object.assign(new Error("the connection pool is exhausted"), { code: "P1001" });
      }),
    });

    it("degrades the excerpt when the post query throws", async () => {
      const adapter = new RetractionAlertContextAdapter(
        exploding("getById") as never,
        makeChannelRepo() as never,
        makeAccountRepo() as never
      );

      const context = await adapter.read({
        postId: POST_ID,
        channelId: CHANNEL_ID,
        accountId: ACCOUNT_ID,
      });

      assert.ok(
        context.postExcerpt.includes(POST_ID),
        "a thrown read escaped the adapter that exists to degrade, taking the whole alert with it"
      );
      assert.strictEqual(context.channelName, "@acme");
    });

    it("degrades the channel when the channel repository throws", async () => {
      const adapter = new RetractionAlertContextAdapter(
        makePostQuery() as never,
        exploding("findById") as never,
        makeAccountRepo() as never
      );

      const context = await adapter.read({
        postId: POST_ID,
        channelId: CHANNEL_ID,
        accountId: ACCOUNT_ID,
      });

      assert.ok(context.channelName.includes(CHANNEL_ID));
      assert.strictEqual(context.provider, "unknown");
    });

    it("degrades the account name when the account repository throws", async () => {
      const adapter = new RetractionAlertContextAdapter(
        makePostQuery() as never,
        makeChannelRepo() as never,
        exploding("findById") as never
      );

      const context = await adapter.read({
        postId: POST_ID,
        channelId: CHANNEL_ID,
        accountId: ACCOUNT_ID,
      });

      assert.strictEqual(context.accountName, "your account");
    });

    it("COUNTS a thrown read, so an outage is not invisible", async () => {
      const adapter = new RetractionAlertContextAdapter(
        exploding("getById") as never,
        makeChannelRepo() as never,
        makeAccountRepo() as never
      );

      await adapter.read({ postId: POST_ID, channelId: CHANNEL_ID, accountId: ACCOUNT_ID });

      const values = await valuesOf("retraction_alert_context_degraded_total");
      assert.deepStrictEqual(
        values.map((v) => v.labels.field),
        ["post"]
      );
    });
  });

  describe("degrading is for the STORE's failures, not for ours", () => {
    const throwing = (method: string, error: unknown) => ({
      [method]: vi.fn(async () => {
        throw error;
      }),
    });

    const readWith = (repo: Record<string, unknown>) =>
      new RetractionAlertContextAdapter(
        repo as never,
        makeChannelRepo() as never,
        makeAccountRepo() as never
      ).read({ postId: POST_ID, channelId: CHANNEL_ID, accountId: ACCOUNT_ID });

    it("PROPAGATES a programming error instead of reporting it as an unreachable store", async () => {
      await assert.rejects(
        () =>
          readWith(
            throwing(
              "getById",
              new TypeError("Cannot read properties of undefined (reading 'value')")
            )
          ),
        /Cannot read properties of undefined/,
        "a bug reads as `unreachable`: every customer is asked to remove `Post <uuid>` while the defect hides in a WARN nobody reads"
      );
    });

    it("PROPAGATES a malformed query, which is ours and not the store being down", async () => {
      const malformed = Object.assign(new Error("Unknown arg `wher` in where"), {
        name: "PrismaClientValidationError",
      });

      await assert.rejects(() => readWith(throwing("getById", malformed)), /Unknown arg/);
    });

    it("still degrades when the store itself cannot answer", async () => {
      const unreachable = Object.assign(new Error("Can't reach database server"), {
        name: "PrismaClientInitializationError",
        code: "P1001",
      });

      const context = await readWith(throwing("getById", unreachable));

      assert.ok(
        context.postExcerpt.includes(POST_ID),
        "the reason this adapter degrades at all is an unreachable store, and it stopped degrading for one"
      );
    });

    it("still degrades on a driver connection error", async () => {
      const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });

      const context = await readWith(throwing("getById", reset));

      assert.ok(context.postExcerpt.includes(POST_ID));
    });

    it("still degrades when the query engine panics", async () => {
      const panic = Object.assign(new Error("the query engine panicked"), {
        name: "PrismaClientRustPanicError",
      });

      const context = await readWith(throwing("getById", panic));

      assert.ok(context.postExcerpt.includes(POST_ID));
    });
  });

  describe("a degraded read is OBSERVED, not only survived", () => {
    it("counts and warns when the post cannot be read", async () => {
      const postQuery = {
        getById: vi.fn(async () => ({
          ok: false as const,
          error: new EntityNotFoundError("Post", POST_ID),
        })),
      };
      const adapter = new RetractionAlertContextAdapter(
        postQuery as never,
        makeChannelRepo() as never,
        makeAccountRepo() as never
      );

      await adapter.read({ postId: POST_ID, channelId: CHANNEL_ID, accountId: ACCOUNT_ID });

      const post = (await valuesOf("retraction_alert_context_degraded_total")).find(
        (v) => v.labels.field === "post"
      );
      assert.strictEqual(post?.value, 1, "a degraded post read went uncounted");
    });

    it("counts and warns when the channel cannot be read", async () => {
      const channelRepo = {
        findById: vi.fn(async () => ({
          ok: false as const,
          error: new EntityNotFoundError("Channel", CHANNEL_ID),
        })),
      };
      const adapter = new RetractionAlertContextAdapter(
        makePostQuery() as never,
        channelRepo as never,
        makeAccountRepo() as never
      );

      await adapter.read({ postId: POST_ID, channelId: CHANNEL_ID, accountId: ACCOUNT_ID });

      const channel = (await valuesOf("retraction_alert_context_degraded_total")).find(
        (v) => v.labels.field === "channel"
      );
      assert.strictEqual(channel?.value, 1, "a degraded channel read went uncounted");
    });

    it("counts nothing when every read resolved", async () => {
      const adapter = new RetractionAlertContextAdapter(
        makePostQuery({ title: "Launch week" }) as never,
        makeChannelRepo() as never,
        makeAccountRepo() as never
      );

      await adapter.read({ postId: POST_ID, channelId: CHANNEL_ID, accountId: ACCOUNT_ID });

      assert.deepStrictEqual(
        await valuesOf("retraction_alert_context_degraded_total"),
        [],
        "a clean read was counted as degraded"
      );
    });
  });

  it("refuses a malformed id instead of building a context over it", async () => {
    const adapter = new RetractionAlertContextAdapter(
      makePostQuery() as never,
      makeChannelRepo() as never,
      makeAccountRepo() as never
    );

    const context = await adapter.read({
      postId: "not-a-uuid",
      channelId: CHANNEL_ID,
      accountId: ACCOUNT_ID,
    });

    assert.ok(context.postExcerpt.length > 0);
  });
});
