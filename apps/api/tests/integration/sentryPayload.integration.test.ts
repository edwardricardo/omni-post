/**
 * @file sentryPayload.integration.test.ts
 * @description The payload gate of the API's Sentry init: no span the SDK hands its transport
 *   carries `db.user`. Sentry's own pg instrumentation writes the database user name on every pg
 *   connect and query span, and the override bands that hold the OpenTelemetry instrumentations
 *   at their fixed releases never reach the copy Sentry vendors; `stripDatabaseUser`, the
 *   `beforeSendSpan` hook `initSentry` passes, is the only thing that keeps the name out
 *   (docs/security/SECURITY_CANON.md, row `@sentry/node` + `@sentry/nextjs`).
 *
 *   The suite runs the order that activates Sentry's pg instrumentation, and so the order that
 *   leaks without the hook: the real `initSentry` first, then `@infra/prisma`, which loads
 *   `@prisma/adapter-pg` and `pg`. The API boots the other way round today, so Sentry's pg
 *   instrumentation never attaches there and only Prisma's own spans reach Sentry, but nothing
 *   holds that order. A query through the production client and adapter then runs against a
 *   refused port inside a span, so the suite needs no database: the pg connect spans carry the
 *   connection's user name whether or not the connection opens.
 *
 *   The transport is the client's own, with its `send` replaced by an in-memory recorder through
 *   the public `getTransport()`: every envelope the SDK sends, after every event processor and
 *   hook ran, is recorded, and nothing leaves the process. The DSN names a host under the
 *   reserved `.invalid` domain all the same. The gate fails on a vacuous run as well as on a leak:
 *   when no span of the pg driver reaches the transport, the instrumentation it exists to watch
 *   did not run, and the absence of `db.user` would prove nothing. Prisma's own spans do not
 *   count: they reach Sentry in either load order and never carry the attribute.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { initSentry, Sentry } from "../../src/observability/sentryInit.js";

/** A DSN on the reserved `.invalid` domain; the in-memory transport sends nothing anyway. */
const DSN = "https://public@sentry-payload-gate.invalid/1";

/** The attribute the gate keeps out of every payload. */
const DB_USER = "db.user";

/** The user name the refused connection presents, so a leak is recognisable in a red run. */
const CONNECTION_USER = "payload_gate_user";

/** A span as it appears in a sent envelope: the transaction's root context or one of its spans. */
interface SentSpan {
  readonly span_id: string;
  readonly op?: unknown;
  readonly description?: unknown;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Whether a span comes from Sentry's pg instrumentation (`pg.connect`, `pg-pool.connect`, a
 * `pg.query`), the spans that carry `db.user`; Prisma's own spans name `prisma:*` or the SQL.
 */
function isPgDriverSpan(span: SentSpan): boolean {
  return (
    typeof span.description === "string" &&
    /^pg[.-]/.test(span.description) &&
    span.data?.["db.system"] === "postgresql"
  );
}

/**
 * Calls `visit` for every plain object `value` holds, at any depth, `value` included.
 */
function walkObjects(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  visit(node);
  for (const child of Object.values(node)) walkObjects(child, visit);
}

/** Every span the envelopes carry: each object with a string `span_id`, root and child alike. */
function spansIn(envelopes: readonly unknown[]): SentSpan[] {
  const spans: SentSpan[] = [];
  walkObjects(envelopes, (node) => {
    if (typeof node.span_id === "string") spans.push(node as unknown as SentSpan);
  });
  return spans;
}

/** Every object in the envelopes that holds `db.user` as an own key, wherever it sits. */
function holdersOfDbUser(envelopes: readonly unknown[]): Record<string, unknown>[] {
  const holders: Record<string, unknown>[] = [];
  walkObjects(envelopes, (node) => {
    if (Object.hasOwn(node, DB_USER)) holders.push(node);
  });
  return holders;
}

describe("the API's Sentry payload", () => {
  const envelopes: unknown[] = [];
  let disconnect: (() => Promise<void>) | undefined;

  before(async () => {
    initSentry(DSN, "integration", 1);
    const client = Sentry.getClient();
    const transport = client?.getTransport();
    assert.ok(transport, "initSentry did not create a Sentry client with a transport");
    transport.send = async (envelope) => {
      envelopes.push(envelope);
      return {};
    };

    // Loaded only now, so `pg` loads after Sentry's instrumentation is in place.
    const { createTestPrismaClient } = await import("@infra/prisma");
    const refused = new URL("postgresql://127.0.0.1:1/sentry_payload_gate");
    refused.username = CONNECTION_USER;
    const prisma = createTestPrismaClient(refused.toString());
    disconnect = () => prisma.$disconnect();

    await Sentry.startSpan({ name: "GET /sentry-payload-gate", op: "http.server" }, async () => {
      // The connection is refused by design; the spans of the attempt are what the gate reads.
      await prisma.$queryRaw`SELECT 1`.catch(() => undefined);
    });
    assert.ok(await Sentry.flush(5_000), "Sentry did not flush within 5 s");
  });

  after(async () => {
    await disconnect?.();
    await Sentry.close(2_000);
  });

  it("delivers the pg driver's spans to the transport, so the gate reads the instrumented path", () => {
    const spans = spansIn(envelopes);
    const pgSpans = spans.filter(isPgDriverSpan);

    assert.ok(envelopes.length > 0, "no envelope reached the transport");
    assert.ok(spans.length > 0, "no span reached the transport");
    assert.ok(
      pgSpans.length > 0,
      `no pg driver span reached the transport, so Sentry's pg instrumentation did not run: ${JSON.stringify(
        spans.map((span) => span.description ?? span.op)
      )}`
    );
  });

  it("delivers no span, root or child, that carries db.user", () => {
    const holders = holdersOfDbUser(envelopes);

    assert.deepEqual(
      holders,
      [],
      `db.user reached the transport ${holders.length} time(s): ${JSON.stringify(holders)}`
    );
    assert.equal(
      JSON.stringify(envelopes).includes(CONNECTION_USER),
      false,
      `the connection user name reached the transport under another attribute`
    );
  });
});
