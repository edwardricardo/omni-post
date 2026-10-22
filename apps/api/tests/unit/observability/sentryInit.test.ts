/**
 * @file sentryInit.test.ts
 * @description Pins the API's Sentry `beforeSendSpan` hook, `stripDatabaseUser`: a span carrying
 *   `db.user` leaves without it and with every other field intact, a span without it leaves
 *   untouched, no span is ever dropped, and `initSentry` hands the hook to `Sentry.init`. That
 *   the hook keeps the attribute out of what Sentry actually sends is measured end to end by the
 *   pg probe recorded with the Sentry row of `docs/security/SECURITY_CANON.md`; this suite pins
 *   the hook's own contract and its wiring.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

import { initSentry, stripDatabaseUser } from "../../../src/observability/sentryInit.js";

type SpanJson = Parameters<typeof stripDatabaseUser>[0];

const makeSpan = (data: SpanJson["data"], overrides?: Partial<SpanJson>): SpanJson => ({
  span_id: "span-0001",
  trace_id: "trace-0001",
  parent_span_id: "span-0000",
  start_timestamp: 1_767_225_600,
  timestamp: 1_767_225_601,
  op: "db",
  description: "pg.connect",
  origin: "auto.db.otel.postgres",
  data,
  ...overrides,
});

describe("stripDatabaseUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the span without db.user and with every other attribute when db.user is present", () => {
    const span = makeSpan({
      "db.user": "omnipost_app",
      "db.system": "postgresql",
      "db.name": "omnipostdb",
      "net.peer.name": "db.internal",
      "net.peer.port": 5432,
    });

    const sent = stripDatabaseUser(span);

    assert.equal(Object.hasOwn(sent.data, "db.user"), false);
    assert.deepEqual(sent.data, {
      "db.system": "postgresql",
      "db.name": "omnipostdb",
      "net.peer.name": "db.internal",
      "net.peer.port": 5432,
    });
    const { data: _sentData, ...sentRest } = sent;
    const { data: _spanData, ...spanRest } = span;
    assert.deepEqual(sentRest, spanRest);
  });

  it("leaves the caller's span untouched when it strips db.user", () => {
    const span = makeSpan({ "db.user": "omnipost_app", "db.system": "postgresql" });

    stripDatabaseUser(span);

    assert.deepEqual(span.data, { "db.user": "omnipost_app", "db.system": "postgresql" });
  });

  it("returns the very span it was given when the span carries no db.user", () => {
    const span = makeSpan({ "http.method": "GET", "http.route": "/health" }, { op: "http.server" });

    const sent = stripDatabaseUser(span);

    assert.equal(sent, span);
    assert.deepEqual(sent.data, { "http.method": "GET", "http.route": "/health" });
  });

  it("never drops a span, whatever its attributes", () => {
    const spans = [
      makeSpan({}),
      makeSpan({ "db.user": "omnipost_app" }),
      makeSpan({ "db.user": undefined, "db.system": "postgresql" }),
    ];

    for (const span of spans) {
      const sent = stripDatabaseUser(span);
      assert.ok(sent !== null && sent !== undefined, "the hook must return a span");
      assert.equal(sent.span_id, span.span_id);
      assert.equal(Object.hasOwn(sent.data, "db.user"), false);
    }
  });
});

describe("initSentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes stripDatabaseUser to Sentry.init as its beforeSendSpan hook when a DSN is configured", () => {
    initSentry("https://public@sentry-test.invalid/1", "production", 0.1);

    assert.equal(sentry.init.mock.calls.length, 1);
    const [options] = sentry.init.mock.calls[0] as [{ beforeSendSpan?: unknown }];
    assert.equal(options.beforeSendSpan, stripDatabaseUser);
  });
});
