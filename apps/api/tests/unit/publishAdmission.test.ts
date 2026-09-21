/**
 * @file publishAdmission.test.ts
 * @description The admission decision of `POST /sagas/post-publishing/start`, exercised as
 *              the pure function it is: no Fastify, no repository, no saga engine. The
 *              decision moved out of the route so these cases can name every branch —
 *              re-drive admitted, nothing re-drivable refused, a delayed re-drive refused,
 *              a contended post refused by the lock, a stranded channel refused by name —
 *              without staging an HTTP request to reach each one.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach } from "vitest";
import client from "prom-client";
import { ErrorCode, err, ok, type Result } from "@shared/types";
import { RETRACTION_REFUSALS } from "@core/posts/retractionRefusals.js";
import type { SemanticLockError, SemanticLockPort } from "@ports/core";
import {
  admitPublishStart,
  admitExistingPostStart,
  refusalToAppError,
  type AdmissionChannelRecord,
  type PublishAdmissionRequest,
} from "../../src/saga/publishAdmission.js";
import { makeExistingPost, makeStrandedPost } from "./sagaIntegration.helpers.js";

const CHANNEL_A = "aa000000-0000-4000-8000-00000000000a";
const CHANNEL_B = "aa000000-0000-4000-8000-00000000000b";

/**
 * @function record
 * @description One channel's admission view, defaulting to "still owed an attempt".
 * @param overrides - The fields the case is about.
 * @returns The record view.
 */
function record(overrides: Partial<AdmissionChannelRecord> = {}): AdmissionChannelRecord {
  return {
    channelId: CHANNEL_A,
    redrivable: true,
    pendingRetraction: false,
    liveFragments: [],
    ...overrides,
  };
}

/**
 * @function request
 * @description A publish-now start for one channel on a post with no record, which is the
 *              shape every case narrows from.
 * @param overrides - The fields the case is about.
 * @returns The admission request.
 */
function request(overrides: Partial<PublishAdmissionRequest> = {}): PublishAdmissionRequest {
  return {
    mode: "publish-now",
    status: "DRAFT",
    records: [],
    requestedChannelIds: [CHANNEL_A],
    lockHolderSagaId: null,
    ...overrides,
  };
}

describe("admitPublishStart — the lock answer (W3)", () => {
  it("refuses 409 PUBLICATION_IN_FLIGHT naming the saga that holds the post", () => {
    const result = admitPublishStart(request({ lockHolderSagaId: "saga-already-running" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.statusCode).toBe(409);
    expect(result.error.code).toBe(ErrorCode.PUBLICATION_IN_FLIGHT);
    expect(result.error.details).toEqual({ sagaId: "saga-already-running" });
  });

  it("answers the lock before the status, because a running publish is the more actionable fact", () => {
    // A FAILED post with nothing re-drivable would be refused 400 on its own. While a
    // saga still holds it, the customer's next move is to wait for that saga, not to
    // reason about a record the running publish is still changing.
    const result = admitPublishStart(
      request({
        status: "FAILED",
        records: [record({ redrivable: false })],
        lockHolderSagaId: "saga-already-running",
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.PUBLICATION_IN_FLIGHT);
  });

  it("admits when nothing holds the post", () => {
    expect(admitPublishStart(request()).ok).toBe(true);
  });
});

describe("admitPublishStart — publish-now over a publication record (D9)", () => {
  it("admits a re-drive while at least one channel can still be attempted", () => {
    const result = admitPublishStart(
      request({
        status: "PARTIALLY_PUBLISHED",
        records: [
          record({ channelId: CHANNEL_A, redrivable: false }),
          record({ channelId: CHANNEL_B }),
        ],
        requestedChannelIds: [CHANNEL_A, CHANNEL_B],
      })
    );

    expect(result.ok).toBe(true);
  });

  it("refuses 400 when the record shows nothing left to publish, and names the status", () => {
    const result = admitPublishStart(
      request({
        status: "PUBLISHED",
        records: [record({ redrivable: false })],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.statusCode).toBe(400);
    // The duplicate-send guard the promotion capability already owns: the harm is a
    // second send, so the refusal has to survive the record becoming the truth.
    expect(result.error.message).toMatch(/PUBLISHED/);
  });

  it("refuses 409 by NAME when a requested channel still holds live fragments", () => {
    const result = admitPublishStart(
      request({
        status: "FAILED",
        records: [
          record({
            channelId: CHANNEL_A,
            redrivable: false,
            pendingRetraction: true,
            liveFragments: [{ index: 1, externalId: "frag-1", url: "https://x.test/1" }],
          }),
          record({ channelId: CHANNEL_B }),
        ],
        requestedChannelIds: [CHANNEL_A, CHANNEL_B],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.statusCode).toBe(409);
    expect(result.error.code).toBe(ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS);
    expect(result.error.details).toEqual({
      channelId: CHANNEL_A,
      fragments: [{ index: 1, externalId: "frag-1", url: "https://x.test/1" }],
    });
  });

  it("refuses the stranded channel even though another channel is re-drivable", () => {
    // Re-sending a thread whose earlier fragments are still live double-posts them, and
    // past the pivot there is no undo — so one stranded channel refuses the request that
    // names it, rather than being dropped from an otherwise admissible set.
    const result = admitPublishStart(
      request({
        status: "FAILED",
        records: [
          record({ channelId: CHANNEL_A, redrivable: false, pendingRetraction: true }),
          record({ channelId: CHANNEL_B }),
        ],
        requestedChannelIds: [CHANNEL_A, CHANNEL_B],
      })
    );

    expect(result.ok && "admitted").toBe(false);
  });

  it("ignores a stranded channel the request does not name", () => {
    const result = admitPublishStart(
      request({
        status: "FAILED",
        records: [
          record({ channelId: CHANNEL_A, redrivable: false, pendingRetraction: true }),
          record({ channelId: CHANNEL_B }),
        ],
        requestedChannelIds: [CHANNEL_B],
      })
    );

    expect(result.ok).toBe(true);
  });

  it("carries the same discriminator the application layer raises, so the two cannot drift", () => {
    // `/start` decides this refusal from the record it already read; the saga step will
    // surface the SAME refusal out of `OpenPublicationEpisodeUseCase` once it issues the
    // command. Two declarations of one string are only safe while something fails when
    // they stop agreeing.
    expect(String(ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS)).toBe(
      RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS
    );
  });
});

describe("admitPublishStart — publish-now over a post with no record", () => {
  it("admits a DRAFT, which is what the route admitted before the record existed", () => {
    expect(admitPublishStart(request({ status: "DRAFT", records: [] })).ok).toBe(true);
  });

  it("refuses a PUBLISHED post with no record, naming the status", () => {
    // Absence is not evidence of "never published". Every post published before this
    // change carries no record, and admitting it would re-send content that is already
    // live — the exact harm the duplicate-send guard exists to prevent.
    const result = admitPublishStart(request({ status: "PUBLISHED", records: [] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.statusCode).toBe(400);
    expect(result.error.message).toMatch(/PUBLISHED/);
  });

  it("refuses a SCHEDULED post with no record", () => {
    expect(admitPublishStart(request({ status: "SCHEDULED", records: [] })).ok).toBe(false);
  });
});

describe("admitPublishStart — schedule mode admits the lifecycle words only (Q14)", () => {
  it("admits a DRAFT", () => {
    expect(admitPublishStart(request({ mode: "schedule", status: "DRAFT" })).ok).toBe(true);
  });

  it("admits a SCHEDULED post, so a re-schedule is not a client error", () => {
    expect(admitPublishStart(request({ mode: "schedule", status: "SCHEDULED" })).ok).toBe(true);
  });

  it("refuses a FAILED post even when its record has a re-drivable channel", () => {
    // A delayed re-drive is refused on purpose: publish-now is the only re-drive route,
    // so a scheduled one would park a re-send behind a timer nobody is watching.
    const result = admitPublishStart(
      request({ mode: "schedule", status: "FAILED", records: [record()] })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.statusCode).toBe(400);
    expect(result.error.message).toMatch(/FAILED/);
  });

  it("refuses a PARTIALLY_PUBLISHED post", () => {
    const result = admitPublishStart(
      request({ mode: "schedule", status: "PARTIALLY_PUBLISHED", records: [record()] })
    );

    expect(result.ok).toBe(false);
  });

  it("still refuses a contended post before it looks at the status", () => {
    const result = admitPublishStart(
      request({ mode: "schedule", status: "DRAFT", lockHolderSagaId: "saga-already-running" })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.PUBLICATION_IN_FLIGHT);
  });
});

/**
 * @function lockStoreAnswering
 * @description A lock backend whose `holder` answers exactly what a case needs, and whose
 *              other members refuse to be called — the admission must never take, release
 *              or clear a lock.
 * @param answer - What `holder` resolves to.
 * @returns The stub and the keys it was asked for.
 */
/** The registered name, in one place: the reset and the scrape must not drift apart. */
const LOCK_UNREADABLE_METRIC = "omnipost_publish_admission_lock_unreadable_total";

/**
 * @function lockUnreadableCounter
 * @description The registered counter, fetched by name rather than imported, so the test
 *              takes no production export it would not otherwise need.
 * @returns The counter.
 */
function lockUnreadableCounter(): client.Counter {
  const metric = client.register.getSingleMetric(LOCK_UNREADABLE_METRIC);
  if (metric === undefined) {
    throw new Error(
      `${LOCK_UNREADABLE_METRIC} is not registered: the admission degradation is counted nowhere`
    );
  }
  return metric as client.Counter;
}

/**
 * @function readLockUnreadableCounter
 * @description Scrapes the degradation counter the way Prometheus would, so a case reads
 *              what the endpoint publishes rather than a value someone held a reference to.
 * @returns The current total, or 0 when the counter has no sample yet.
 */
async function readLockUnreadableCounter(): Promise<number> {
  const metrics = await client.register.getMetricsAsJSON();
  const counter = metrics.find((metric) => metric.name === LOCK_UNREADABLE_METRIC);
  if (counter === undefined) {
    throw new Error(
      `${LOCK_UNREADABLE_METRIC} is not registered: the admission degradation is counted nowhere`
    );
  }
  return counter.values?.[0]?.value ?? 0;
}

function lockStoreAnswering(answer: Result<string | null, SemanticLockError>): {
  store: SemanticLockPort;
  readKeys: string[];
} {
  const readKeys: string[] = [];
  const refuse = async (): Promise<never> => {
    throw new Error("the admission must not mutate the lock");
  };
  return {
    readKeys,
    store: {
      acquire: refuse,
      release: refuse,
      releaseAllForSaga: refuse,
      holder: async (key: string) => {
        readKeys.push(key);
        return answer;
      },
    },
  };
}

describe("admitExistingPostStart — gathering what the decision reads", () => {
  it("reads the lock under the post's own key and refuses when it is held", async () => {
    const post = makeExistingPost();
    const { store, readKeys } = lockStoreAnswering(ok("saga-in-flight"));

    const result = await admitExistingPostStart({
      post,
      mode: "publish-now",
      requestedChannelIds: [CHANNEL_A],
      lockStore: store,
    });

    expect(readKeys).toEqual([`post-publishing:${post.id.value}`]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.PUBLICATION_IN_FLIGHT);
  });

  // The counter is reset before each of the three cases below, which is what lets them
  // assert an ABSOLUTE value. The before/after delta they used instead was not robust: it
  // reads the shared registry twice, so any increment landing between the two reads is
  // absorbed into the answer. Measured with the three cases marked `.concurrent` — three
  // runs, the same two failures each time, `expected 1 to be +0`.
  //
  // Resetting the whole registry is NOT the option here, and that is measured too: the
  // sibling suites that call `client.register.clear()` own their registry, whereas
  // `businessMetrics.ts` registers its counters at import time and holds module-level
  // references to them. Clearing would leave those references pointing at unregistered
  // counters for the rest of the process, and the scrape below would stop finding this one
  // at all. One metric, reset by name.
  beforeEach(() => {
    lockUnreadableCounter().reset();
  });

  it("counts the degradation when it admits on an UNREADABLE lock", async () => {
    // A log alone would fire once per start for as long as the store stays unreachable —
    // noise, not signal — and nothing would alert. The counter is what makes "we ran
    // without the in-flight check for forty minutes" discoverable afterwards.
    const { store } = lockStoreAnswering(err("CONNECTION_ERROR"));

    await admitExistingPostStart({
      post: makeExistingPost(),
      mode: "publish-now",
      requestedChannelIds: [CHANNEL_A],
      lockStore: store,
    });

    expect(await readLockUnreadableCounter()).toBe(1);
  });

  it("counts nothing when the holder is readable", async () => {
    const { store } = lockStoreAnswering(ok(null));

    await admitExistingPostStart({
      post: makeExistingPost(),
      mode: "publish-now",
      requestedChannelIds: [CHANNEL_A],
      lockStore: store,
    });

    expect(await readLockUnreadableCounter()).toBe(0);
  });

  it("counts nothing when no lock backend is configured", async () => {
    // MEASURED, and the reason this counter carries no `reason` label: the api composition
    // root constructs `RedisSemanticLockStore` unconditionally outside `SCHEMA_ONLY`
    // (`index.ts:730-733`), and `SCHEMA_ONLY` serves no request — so an absent backend is
    // a test-only state in a serving deployment. A label whose only producer is this suite
    // would read as coverage of a condition that cannot occur. Should the backend ever
    // become conditional, this arm needs its own count and this case is where that shows.
    await admitExistingPostStart({
      post: makeExistingPost(),
      mode: "publish-now",
      requestedChannelIds: [CHANNEL_A],
      lockStore: undefined,
    });

    expect(await readLockUnreadableCounter()).toBe(0);
  });

  it("admits on an UNREADABLE lock rather than refusing every publish while the store is down", async () => {
    // Deliberate, and the reason it is a case: the port keeps the failure a failure so no
    // caller mistakes it for an empty key, and this caller then chooses availability. The
    // guarantee does not rest here — the saga's own step acquires the lock and fails closed
    // on contention, and the job ids dedupe.
    const post = makeExistingPost();
    const { store } = lockStoreAnswering(err("CONNECTION_ERROR"));

    const result = await admitExistingPostStart({
      post,
      mode: "publish-now",
      requestedChannelIds: [CHANNEL_A],
      lockStore: store,
    });

    expect(result.ok).toBe(true);
  });

  it("reads no lock at all when the deployment runs without a backend", async () => {
    const result = await admitExistingPostStart({
      post: makeExistingPost(),
      mode: "publish-now",
      requestedChannelIds: [CHANNEL_A],
      lockStore: undefined,
    });

    expect(result.ok).toBe(true);
  });

  it("passes the post's real record to the decision, not an empty one", async () => {
    // The gatherer is the only place the aggregate is reduced to the admission view, so a
    // mapping that dropped `pendingRetraction` would make every stranded channel look
    // re-drivable and this is where that shows.
    const post = makeStrandedPost();
    const firstChannel = post.publications.all[0];
    expect(firstChannel).toBeDefined();

    const result = await admitExistingPostStart({
      post,
      mode: "publish-now",
      requestedChannelIds: [firstChannel!.channelId.value],
      lockStore: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS);
  });
});

describe("refusalToAppError", () => {
  it("carries the discriminator as the error code and the payload as details", () => {
    const answer = refusalToAppError({
      statusCode: 409,
      code: ErrorCode.PUBLICATION_IN_FLIGHT,
      message: "already running",
      details: { sagaId: "saga-1" },
    });

    expect(answer.statusCode).toBe(409);
    expect(answer.code).toBe(ErrorCode.PUBLICATION_IN_FLIGHT);
    expect(answer.details).toEqual({ sagaId: "saga-1" });
    // Operational: the global handler logs it as a warning and keeps the message, instead
    // of replacing it with a generic internal-error text.
    expect(answer.isOperational).toBe(true);
  });

  it("omits details when the refusal has none", () => {
    const answer = refusalToAppError({
      statusCode: 400,
      code: ErrorCode.BAD_REQUEST,
      message: "not publishable",
    });

    expect(answer.details).toBeUndefined();
  });
});
