/**
 * @file loggerPortContract.test.ts
 * @description Runtime half of the `LoggerPort` contract. The logger the redacting
 *   `createLogger(name)` returns is used through the port's type, exactly as the
 *   composition root hands it to an application service, and the serialized line its
 *   destination receives must carry the logger's name, the message and the context as
 *   fields, with redaction applied. The compile-time half, which pins the argument
 *   order, is `loggerPortContract.type-test.ts`.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import pino from "pino";
import type { LoggerPort } from "@ports/core";
import { createLogger } from "../../../src/lib/logger.js";

interface Harness {
  readonly port: LoggerPort;
  readonly lines: () => Record<string, unknown>[];
}

/**
 * Builds the factory's logger as a `LoggerPort` and captures the lines its destination
 * receives. The level is pinned to `warn` so the assertions do not depend on
 * `LOG_LEVEL`, and the destination's `write` is replaced so nothing reaches the output.
 */
function portFromFactory(name: string): Harness {
  const logger = createLogger(name);
  logger.level = "warn";
  const destination = Reflect.get(logger, pino.symbols.streamSym) as
    { write(line: string): boolean } | undefined;
  // `pino.symbols` is pino's exported extension surface, not a private; still, a pino that
  // stops exposing the destination there must fail HERE, by name, and not later as an empty
  // capture that reads like a port writing nothing.
  if (typeof destination?.write !== "function") {
    throw new Error(
      "pino.symbols.streamSym no longer resolves the logger's destination: update this capture before trusting the assertions"
    );
  }
  const write = vi.spyOn(destination, "write").mockImplementation(() => true);
  const port: LoggerPort = logger;
  return {
    port,
    lines: () => write.mock.calls.map(([line]) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("LoggerPort over the redacting createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes an error entry with the name, the message and the context as fields when error is called with context", () => {
    const { port, lines } = portFromFactory("gateway-billing");

    port.error(
      { err: new Error("connection lost"), accountId: "account-001" },
      "Failed to initiate gateway switch"
    );

    const [entry, ...rest] = lines();
    assert.deepStrictEqual(rest, []);
    assert.ok(entry);
    assert.strictEqual(entry.level, "error");
    assert.strictEqual(entry.name, "gateway-billing");
    assert.strictEqual(entry.service, "omnipost-api");
    assert.strictEqual(entry.msg, "Failed to initiate gateway switch");
    assert.strictEqual(entry.accountId, "account-001");
    const err = entry.err as Record<string, unknown>;
    assert.strictEqual(err.type, "Error");
    assert.strictEqual(err.message, "connection lost");
  });

  it("writes a warn entry with the name and the message when warn is called with the message alone", () => {
    const { port, lines } = portFromFactory("dlq-archival");

    port.warn("DLQ archival: stale unresolved events detected");

    const [entry] = lines();
    assert.ok(entry);
    assert.strictEqual(entry.level, "warn");
    assert.strictEqual(entry.name, "dlq-archival");
    assert.strictEqual(entry.msg, "DLQ archival: stale unresolved events detected");
  });

  it("redacts credential fields when the context carries them", () => {
    const { port, lines } = portFromFactory("compliance");

    port.error(
      { password: "hunter2", token: "reset-token-value", requestorEmail: "user@example.com" },
      "Failed to submit DSAR request"
    );

    const [entry] = lines();
    assert.ok(entry);
    assert.strictEqual(entry.password, "[REDACTED]");
    assert.strictEqual(entry.token, "[REDACTED]");
    assert.strictEqual(entry.requestorEmail, "user@example.com");
  });
});
