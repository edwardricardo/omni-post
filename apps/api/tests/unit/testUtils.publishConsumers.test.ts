/**
 * @file testUtils.publishConsumers.test.ts
 * @description Pins the six causes `assertPublishConsumers` must tell apart. The
 *              suite it guards used to report a missing consumer as three
 *              per-test timeouts saying "did not reach terminal state" — a
 *              symptom four inference steps from the cause, six minutes after the
 *              fact. Replacing that with one message that is wrong in a
 *              DIFFERENT way (naming the workers when the API is down, or when
 *              the probe was rate-limited, or when the queue could not be read)
 *              would reintroduce the same defect inside the fix. Each case below
 *              asserts its OWN message.
 * @layer infrastructure
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertPublishConsumers,
  checkApiAvailable,
  PUBLISH_CONSUMER_PROBE_TIMEOUT_MS,
} from "../testUtils.js";

/** Builds a fetch double answering every call with the same canned response. */
function stubFetch(responder: () => Promise<Response> | Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responder())
  );
}

/** A JSON `Response` with the given status and body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The queue-dependency payload the API serves when its checker ran. */
function dependencyBody(details: Record<string, unknown> | undefined) {
  return {
    ok: true,
    dependency: "queue",
    status: "healthy",
    ...(details !== undefined && { details }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertPublishConsumers tells its six causes apart", () => {
  it("names the API, not the workers, when the probe cannot reach the API at all", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/API is unreachable/i);
    expect(result.message).not.toMatch(/no process is consuming/i);
  });

  it("names rate limiting, not a missing consumer, on 429", async () => {
    // The queue dependency path prefix-matches the `/health` rate-limit rule, and
    // the batch that runs immediately before the live saga suite deliberately
    // bursts that bucket. A 429 read as "no consumer" would send the reader to
    // restart workers that are running.
    stubFetch(() => jsonResponse(429, { error: "Too Many Requests" }));

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rate-limited/i);
    expect(result.message).not.toMatch(/no process is consuming/i);
  });

  it("says the queue could not be READ when the dependency is unhealthy with no details", async () => {
    // The health circuit breaker returns CONNECTION_ERROR with no details. That
    // is an unreadable queue — unknown, not zero.
    stubFetch(() => jsonResponse(503, { ok: false, dependency: "queue", status: "unhealthy" }));

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be read/i);
    expect(result.message).not.toMatch(/no process is consuming/i);
  });

  it("says unknown, not zero, when the broker cannot answer its client registry", async () => {
    stubFetch(() => jsonResponse(200, dependencyBody({ consumers: null })));

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cannot answer|unknown/i);
    expect(result.message).not.toMatch(/no process is consuming/i);
  });

  it("says the API predates the field when the payload carries no consumer count", async () => {
    stubFetch(() => jsonResponse(200, dependencyBody({ waiting: 0 })));

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/does not report a consumer count|rebuild|restart/i);
    expect(result.message).not.toMatch(/no process is consuming/i);
  });

  it("names the queue and the remedy when nothing is consuming it", async () => {
    stubFetch(() => jsonResponse(200, dependencyBody({ consumers: 0 })));

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No process is consuming the 'publish' queue/);
    expect(result.message).toMatch(/pnpm dev/);
  });

  it("passes, cheaply, when a consumer is attached", async () => {
    stubFetch(() => jsonResponse(200, dependencyBody({ consumers: 2 })));

    const startedAt = Date.now();
    const result = await assertPublishConsumers();
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(true);
    // R2-f: a check nobody can afford is a check somebody deletes.
    expect(elapsed).toBeLessThan(2_000);
  });

  it("does not retry the decided case, so a real outage is reported immediately", async () => {
    // `consumers: 0` is an ANSWER, not an indeterminate one. Retrying it would
    // spend the whole budget confirming something already known.
    const fetchSpy = vi.fn(async () => jsonResponse(200, dependencyBody({ consumers: 0 })));
    vi.stubGlobal("fetch", fetchSpy);

    await assertPublishConsumers();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries an indeterminate answer within the suite-setup budget", async () => {
    // 429 and transport errors are transient by nature; a single sample would
    // make the precondition itself flaky, which is how preconditions get deleted.
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(429, { error: "Too Many Requests" })
        : jsonResponse(200, dependencyBody({ consumers: 1 }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await assertPublishConsumers();

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps its per-attempt timeout inside the 5-second setup verdict bound", async () => {
    // Two attempts 500ms apart at this timeout is the worst case; the constant is
    // asserted rather than described so the arithmetic cannot drift.
    expect(PUBLISH_CONSUMER_PROBE_TIMEOUT_MS * 2 + 500).toBeLessThanOrEqual(5_000);
  });
});

describe("checkApiAvailable", () => {
  it("treats a rate-limited API as available", async () => {
    // A 429 proves the API is up — it answered. Reading it as "API down" made the
    // saga suite's existing precondition go red naming the wrong cause, right
    // after the batch that deliberately exhausts the `/health` bucket.
    stubFetch(() => jsonResponse(429, { error: "Too Many Requests" }));

    expect(await checkApiAvailable()).toBe(true);
  });

  it("treats a server error as unavailable", async () => {
    stubFetch(() => jsonResponse(503, { error: "unavailable" }));

    expect(await checkApiAvailable()).toBe(false);
  });

  it("treats a transport failure as unavailable", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });

    expect(await checkApiAvailable()).toBe(false);
  });
});
