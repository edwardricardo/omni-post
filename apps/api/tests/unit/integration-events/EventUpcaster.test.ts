/**
 * Unit Tests - EventUpcaster / UpcasterChain
 *
 * Part of P2-5: Event Versioning Strategy
 * Tier-0 tests for the upcaster chain: registration, single-hop, multi-hop,
 * canUpcast checks, and edge cases.
 *
 * Strategy:
 * - All tests are pure in-memory — no I/O, no database, no Redis.
 * - Tests use simple literal upcasters that add/transform fields.
 * - The `UpcasterChain` is exercised in isolation of the consumer.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UpcasterChain,
  type Upcaster,
} from "../../../src/infrastructure/integration-events/EventUpcaster.js";

// ---------------------------------------------------------------------------
// Helper types for test payloads
// ---------------------------------------------------------------------------

interface PayloadV1 {
  postId: string;
  body: string;
}

interface PayloadV2 {
  postId: string;
  body: string;
  tags: string[]; // added in v2
}

interface PayloadV3 {
  postId: string;
  body: string;
  tags: string[];
  contentType: string; // added in v3
}

// ---------------------------------------------------------------------------
// Single upcaster v1 → v2
// ---------------------------------------------------------------------------

describe("UpcasterChain — single upcaster v1→v2", { concurrency: 1 }, () => {
  it("upcasts v1 payload to v2 by applying the registered upcaster", () => {
    const chain = new UpcasterChain();
    const upcaster: Upcaster<PayloadV1, PayloadV2> = {
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p) => ({ ...p, tags: [] }),
    };
    chain.register(upcaster);

    const result = chain.upcast("PostCreated", { postId: "p1", body: "Hello" }, 1, 2);

    assert.deepEqual(result.payload, { postId: "p1", body: "Hello", tags: [] });
    assert.equal(result.version, 2);
  });

  it("returns original payload when fromVersion already equals targetVersion", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1) => ({ ...p, tags: [] }),
    });

    const payload = { postId: "p1", body: "Hello" };
    const result = chain.upcast("PostCreated", payload, 2, 2);

    assert.deepEqual(result.payload, payload);
    assert.equal(result.version, 2);
  });

  it("returns original payload when no upcaster registered for that eventType", () => {
    const chain = new UpcasterChain();
    const payload = { postId: "p1", body: "Hello" };
    const result = chain.upcast("UnknownEvent", payload, 1, 2);

    assert.deepEqual(result.payload, payload);
    assert.equal(result.version, 1);
  });

  it("returns original payload when no upcaster registered for that fromVersion", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2) => ({ ...p, contentType: "text" }),
    });

    const payload = { postId: "p1", body: "Hello" };
    // fromVersion=1 has no upcaster registered
    const result = chain.upcast("PostCreated", payload, 1, 3);

    assert.deepEqual(result.payload, payload);
    assert.equal(result.version, 1); // chain stopped because v1→v2 is missing
  });

  it("stops at the highest available version when targetVersion is not provided", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1) => ({ ...p, tags: [] }),
    });

    const result = chain.upcast("PostCreated", { postId: "p1", body: "Hello" }, 1);

    assert.equal(result.version, 2);
    assert.deepEqual(result.payload, { postId: "p1", body: "Hello", tags: [] });
  });
});

// ---------------------------------------------------------------------------
// Chain: v1 → v2 → v3
// ---------------------------------------------------------------------------

describe("UpcasterChain — chained upcasters v1→v2→v3", { concurrency: 1 }, () => {
  it("applies both upcasters sequentially to reach v3", () => {
    const chain = new UpcasterChain();

    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: [] }),
    });
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2): PayloadV3 => ({ ...p, contentType: "text" }),
    });

    const result = chain.upcast("PostCreated", { postId: "p1", body: "Hello" }, 1, 3);

    assert.equal(result.version, 3);
    assert.deepEqual(result.payload, {
      postId: "p1",
      body: "Hello",
      tags: [],
      contentType: "text",
    });
  });

  it("stops at v2 when targetVersion is 2 even if v3 upcaster is registered", () => {
    const chain = new UpcasterChain();

    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: [] }),
    });
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2): PayloadV3 => ({ ...p, contentType: "text" }),
    });

    const result = chain.upcast("PostCreated", { postId: "p1", body: "Hi" }, 1, 2);

    assert.equal(result.version, 2);
    assert.deepEqual(result.payload, { postId: "p1", body: "Hi", tags: [] });
  });

  it("starting from v2 only applies v2→v3, skips v1→v2", () => {
    const chain = new UpcasterChain();

    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: ["SHOULD_NOT_APPEAR"] }),
    });
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2): PayloadV3 => ({ ...p, contentType: "image" }),
    });

    const result = chain.upcast(
      "PostCreated",
      { postId: "p1", body: "Hi", tags: ["existing"] },
      2,
      3
    );

    assert.equal(result.version, 3);
    const p = result.payload as PayloadV3;
    assert.deepEqual(p.tags, ["existing"], "should not re-apply v1→v2 upcaster");
    assert.equal(p.contentType, "image");
  });

  it("upcast without targetVersion walks the entire chain v1→v3", () => {
    const chain = new UpcasterChain();

    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: ["auto"] }),
    });
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2): PayloadV3 => ({ ...p, contentType: "video" }),
    });

    const result = chain.upcast("PostCreated", { postId: "p1", body: "Hi" }, 1);

    assert.equal(result.version, 3);
    const p = result.payload as PayloadV3;
    assert.equal(p.contentType, "video");
    assert.deepEqual(p.tags, ["auto"]);
  });
});

// ---------------------------------------------------------------------------
// canUpcast
// ---------------------------------------------------------------------------

describe("UpcasterChain — canUpcast", { concurrency: 1 }, () => {
  it("returns true when direct v1→v2 path exists", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: [] }),
    });

    assert.equal(chain.canUpcast("PostCreated", 1, 2), true);
  });

  it("returns true when v1→v2→v3 path exists", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: [] }),
    });
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2): PayloadV3 => ({ ...p, contentType: "text" }),
    });

    assert.equal(chain.canUpcast("PostCreated", 1, 3), true);
  });

  it("returns false when the v1→v2 link is missing in a v1→v2→v3 chain", () => {
    const chain = new UpcasterChain();
    // Only v2→v3 registered, missing v1→v2
    chain.register({
      eventType: "PostCreated",
      fromVersion: 2,
      toVersion: 3,
      upcast: (p: PayloadV2): PayloadV3 => ({ ...p, contentType: "text" }),
    });

    assert.equal(chain.canUpcast("PostCreated", 1, 3), false);
  });

  it("returns false when the event type is not registered", () => {
    const chain = new UpcasterChain();
    assert.equal(chain.canUpcast("UnknownEvent", 1, 2), false);
  });

  it("returns true when fromVersion equals targetVersion (already at target)", () => {
    const chain = new UpcasterChain();
    assert.equal(chain.canUpcast("PostCreated", 2, 2), true);
  });

  it("returns true when fromVersion is greater than targetVersion", () => {
    const chain = new UpcasterChain();
    // version 3 is already past the target 2 — no upcast needed
    assert.equal(chain.canUpcast("PostCreated", 3, 2), true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("UpcasterChain — edge cases", { concurrency: 1 }, () => {
  it("registeredEventTypes is empty for a fresh chain", () => {
    const chain = new UpcasterChain();
    assert.deepEqual(chain.registeredEventTypes, []);
  });

  it("registeredEventTypes lists event types with registered upcasters", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1) => ({ ...p, tags: [] }),
    });
    chain.register({
      eventType: "PostPublished",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: unknown) => p,
    });

    const types = chain.registeredEventTypes.sort();
    assert.deepEqual(types, ["PostCreated", "PostPublished"]);
  });

  it("overwriting a registered upcaster replaces the previous one", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (_p: PayloadV1): PayloadV2 => ({ postId: "old", body: "old", tags: ["old"] }),
    });
    chain.register({
      eventType: "PostCreated",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: PayloadV1): PayloadV2 => ({ ...p, tags: ["new"] }),
    });

    const result = chain.upcast("PostCreated", { postId: "p1", body: "Hi" }, 1, 2);
    const p = result.payload as PayloadV2;
    assert.deepEqual(p.tags, ["new"], "second registration should overwrite first");
  });

  it("upcaster with non-object payload (e.g. string) passes through unchanged", () => {
    const chain = new UpcasterChain();
    chain.register({
      eventType: "TestEvent",
      fromVersion: 1,
      toVersion: 2,
      upcast: (p: unknown) => String(p) + "_v2",
    });

    const result = chain.upcast("TestEvent", "raw_string", 1, 2);
    assert.equal(result.payload, "raw_string_v2");
    assert.equal(result.version, 2);
  });
});
