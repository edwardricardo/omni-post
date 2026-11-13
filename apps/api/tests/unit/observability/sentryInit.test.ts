/**
 * @file sentryInit.test.ts
 * @description Pins the API's Sentry `beforeSendSpan` hook, `scrubSpanForSentry`, and the step it
 *   is built on, `stripDatabaseUser`. A span carrying `db.user` leaves without it and with every
 *   other field intact, an own `db.user` key holding `undefined` is removed rather than kept, a
 *   span without it leaves untouched, and no span is ever dropped. The hook also replaces the value
 *   of every sensitive query parameter in the span's attributes and description with `REDACTED`:
 *   Sentry 10.76.2 filters `access_token` itself but sends `code` and `state` as written, in
 *   `url.full`, `http.url`, `http.target` and `http.query` of an inbound request's span (measured
 *   on loopback with fake values). `initSentry` calls `Sentry.init` once, with the hook, when a DSN
 *   is configured, and not at all without a DSN, in the test environment or on a second call. That
 *   the hook keeps `db.user` out of what Sentry actually sends is the payload gate
 *   `tests/integration/sentryPayload.integration.test.ts`; this suite pins the hook's own contract
 *   and its wiring. Every value is fake.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

import { scrubSpanForSentry, stripDatabaseUser } from "../../../src/observability/sentryInit.js";
import { env } from "../../../src/config/env.js";

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

  it("removes an own db.user key that holds undefined instead of keeping it", () => {
    const span = makeSpan({ "db.user": undefined, "db.system": "postgresql" });

    const sent = stripDatabaseUser(span);

    assert.equal(Object.hasOwn(sent.data, "db.user"), false);
    assert.deepEqual(Object.keys(sent.data), ["db.system"]);
    assert.equal(sent.data["db.system"], "postgresql");
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

describe("scrubSpanForSentry", () => {
  const CALLBACK = "/auth/callback/facebook";
  const RAW_QUERY = "code=FAKE_CODE_S1&state=FAKE_STATE_S1&access_token=[Filtered]&page=2";
  const REDACTED_QUERY = "code=REDACTED&state=REDACTED&access_token=REDACTED&page=2";

  /** An inbound request's span in the shape Sentry 10.76.2 hands `beforeSendSpan`. */
  const makeInboundSpan = (): SpanJson =>
    makeSpan(
      {
        "url.full": `http://127.0.0.1:3000${CALLBACK}?${RAW_QUERY}`,
        "http.url": `http://127.0.0.1:3000${CALLBACK}?${RAW_QUERY}`,
        "http.target": `${CALLBACK}?${RAW_QUERY}`,
        "http.query": RAW_QUERY,
        "url.path": CALLBACK,
        url: `http://127.0.0.1:3000${CALLBACK}`,
        "http.method": "GET",
        "http.response.status_code": 200,
      },
      { op: "http.server", description: `GET ${CALLBACK}`, origin: "auto.http.otel.http" }
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts code and state in every URL attribute of an inbound span and keeps every other field", () => {
    const span = makeInboundSpan();

    const sent = scrubSpanForSentry(span);

    assert.deepEqual(sent.data, {
      "url.full": `http://127.0.0.1:3000${CALLBACK}?${REDACTED_QUERY}`,
      "http.url": `http://127.0.0.1:3000${CALLBACK}?${REDACTED_QUERY}`,
      "http.target": `${CALLBACK}?${REDACTED_QUERY}`,
      "http.query": REDACTED_QUERY,
      "url.path": CALLBACK,
      url: `http://127.0.0.1:3000${CALLBACK}`,
      "http.method": "GET",
      "http.response.status_code": 200,
    });
    const { data: _sentData, ...sentRest } = sent;
    const { data: _spanData, ...spanRest } = span;
    assert.deepEqual(sentRest, spanRest);
    assert.equal(JSON.stringify(sent).includes("FAKE_"), false);
  });

  it("redacts the url.query of an outbound fetch span, which keeps its leading question mark", () => {
    const span = makeSpan(
      { "url.query": "?fields=id&access_token=FAKE_TOKEN_S2", "url.path": "/v23.0/me" },
      { op: "http.client", description: "GET https://graph.facebook.com/v23.0/me" }
    );

    const sent = scrubSpanForSentry(span);

    assert.deepEqual(sent.data, {
      "url.query": "?fields=id&access_token=REDACTED",
      "url.path": "/v23.0/me",
    });
  });

  it("redacts a sensitive query value the span's description carries", () => {
    const span = makeSpan(
      {},
      { op: "http.client", description: "GET /oauth/token?code=FAKE_CODE_S3" }
    );

    const sent = scrubSpanForSentry(span);

    assert.equal(sent.description, "GET /oauth/token?code=REDACTED");
    assert.deepEqual(sent.data, {});
  });

  it("removes db.user as stripDatabaseUser does, together with the query redaction", () => {
    const span = makeSpan({
      "db.user": "omnipost_app",
      "db.system": "postgresql",
      "url.full": "http://127.0.0.1:3000/cb?state=FAKE_STATE_S4",
    });

    const sent = scrubSpanForSentry(span);

    assert.deepEqual(sent.data, {
      "db.system": "postgresql",
      "url.full": "http://127.0.0.1:3000/cb?state=REDACTED",
    });
  });

  it("leaves the caller's span untouched when it redacts", () => {
    const span = makeInboundSpan();
    const before = structuredClone(span);

    scrubSpanForSentry(span);

    assert.deepEqual(span, before);
  });

  it("returns the very span it was given when it carries neither db.user nor a sensitive query value", () => {
    const span = makeSpan(
      { "url.full": "http://127.0.0.1:3000/posts?page=2", "http.route": "/posts" },
      { op: "http.server", description: "GET /posts" }
    );

    assert.equal(scrubSpanForSentry(span), span);
  });
});

describe("initSentry", () => {
  const DSN = "https://public@sentry-test.invalid/1";

  /** A fresh copy of the module, so its once-only latch starts unset in every case. */
  const freshSentryInit = async () => {
    vi.resetModules();
    return import("../../../src/observability/sentryInit.js");
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Sentry.init exactly once, with scrubSpanForSentry as beforeSendSpan, when a DSN is configured", async () => {
    const api = await freshSentryInit();

    api.initSentry(DSN, "production", 0.1);

    assert.equal(sentry.init.mock.calls.length, 1);
    const [options] = sentry.init.mock.calls[0] as [{ beforeSendSpan?: unknown }];
    assert.equal(options.beforeSendSpan, api.scrubSpanForSentry);
  });

  it("hands Sentry.init a beforeSendSpan that removes db.user and redacts sensitive query values", async () => {
    const api = await freshSentryInit();

    api.initSentry(DSN, "production", 0.1);

    const [options] = sentry.init.mock.calls[0] as [
      { beforeSendSpan: (span: SpanJson) => SpanJson },
    ];
    const sent = options.beforeSendSpan(
      makeSpan({ "db.user": "omnipost_app", "http.query": "code=FAKE_CODE_S5&page=1" })
    );
    assert.deepEqual(sent.data, { "http.query": "code=REDACTED&page=1" });
  });

  it("does not call Sentry.init again when it is called a second time after initializing", async () => {
    const api = await freshSentryInit();

    api.initSentry(DSN, "production", 0.1);
    api.initSentry(DSN, "staging", 1);

    assert.equal(sentry.init.mock.calls.length, 1);
  });

  it("does not call Sentry.init when no DSN is configured, null or empty", async () => {
    const api = await freshSentryInit();

    api.initSentry(null, "production", 0.1);
    api.initSentry("", "production", 0.1);

    assert.equal(sentry.init.mock.calls.length, 0);
  });

  it("does not call Sentry.init in the test environment, named or taken from NODE_ENV", async () => {
    assert.equal(
      env.NODE_ENV,
      "test",
      "the default environment of this case is the suite's NODE_ENV"
    );
    const api = await freshSentryInit();

    api.initSentry(DSN, "test", 0.1);
    api.initSentry(DSN);

    assert.equal(sentry.init.mock.calls.length, 0);
  });
});
