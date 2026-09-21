/**
 * @file sagaStartAdmission.test.ts
 * @description The `/sagas/post-publishing/start` route wired to the admission decision:
 *              that the real publication record reaches it, that the semantic lock is read
 *              before the saga starts, and that each refusal becomes the HTTP answer the
 *              customer branches on. The decision's own branches are covered by
 *              `publishAdmission.test.ts`; what is proved here is the WIRING — a route that
 *              decided correctly over a record it never read would pass there and fail here.
 * @layer infrastructure
 */
import { describe, it, afterEach, expect } from "vitest";
import { AppError, ErrorCode } from "@shared/types";
import { PublishStatus } from "@core/domain/index.js";
import { SagaIntegration } from "../../src/saga/SagaIntegration.js";
import { InMemorySemanticLockStore } from "./doubles/InMemorySemanticLockStore.js";
import {
  buildIntegration,
  makeExistingPost,
  makeFullyPublishedPost,
  makeStrandedPost,
  makeStartRequest,
  passthroughReply,
  TEST_CHANNEL_IDS,
  TEST_EXISTING_DRAFT_POST_ID,
  type MockQueue,
} from "./sagaIntegration.helpers.js";

type RouteHandler = (req: any, reply: any) => any;

/**
 * @function startRequest
 * @description A start body for the existing post, in the mode and channel set the case is about.
 * @param mode - Which start mode.
 * @param channelIds - The channels the caller names.
 * @returns The request stub.
 */
function startRequest(
  mode: "schedule" | "publish-now",
  channelIds: readonly string[] = [TEST_CHANNEL_IDS[0]!]
): ReturnType<typeof makeStartRequest> {
  const request = makeStartRequest({ mode });
  request.body = {
    mode,
    projectId: request.body.projectId,
    postId: TEST_EXISTING_DRAFT_POST_ID,
    channelIds: [...channelIds],
    ...(mode === "schedule" && {
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  };
  return request;
}

/**
 * @function refusalOfStart
 * @description Runs the route and returns the `AppError` it refused with.
 * @param handler - The route handler.
 * @param request - The request stub.
 * @returns The refusal.
 */
async function refusalOfStart(handler: RouteHandler, request: unknown): Promise<AppError> {
  try {
    await handler(request, passthroughReply);
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error("the start was admitted, but this case expects a refusal");
}

describe("POST /sagas/post-publishing/start — admission over the publication record", () => {
  let integration: SagaIntegration;
  let routes: Map<string, RouteHandler>;

  afterEach(async () => {
    await integration.shutdown();
  });

  /**
   * @function boot
   * @description Builds an integration over the given post and lock store.
   * @param overrides - The post and lock store the case needs.
   * @returns The route handler under test.
   */
  async function boot(
    overrides: Parameters<typeof buildIntegration>[0] = {}
  ): Promise<RouteHandler> {
    ({ integration, routes } = await buildIntegration(overrides));
    const handler = routes.get("POST:/sagas/post-publishing/start");
    if (handler === undefined) {
      throw new Error("the start route is not registered");
    }
    return handler;
  }

  it("refuses a publish-now whose record has nothing left to send, and names the status", async () => {
    const handler = await boot({ post: makeFullyPublishedPost() });

    const refusal = await refusalOfStart(handler, startRequest("publish-now"));

    expect(refusal.statusCode).toBe(400);
    // The harm is a duplicate send, so the assertion the promotion capability already
    // owns is preserved: the answer names the word that makes the post ineligible.
    expect(refusal.message).toMatch(/SCHEDULED|PUBLISHED|PARTIALLY_PUBLISHED/);
  });

  it("admits a publish-now while the record still owes a channel an attempt", async () => {
    const stranded = makeStrandedPost();
    const handler = await boot({ post: stranded });

    // Only the channel that is still owed an attempt is named, so the refusal below is
    // not what answers this case.
    const result = await handler(
      startRequest("publish-now", [TEST_CHANNEL_IDS[1]!]),
      passthroughReply
    );

    expect(result.success).toBe(true);
    expect(result.data.mode).toBe("publish-now");
  });

  it("refuses 409 CHANNEL_HAS_LIVE_FRAGMENTS naming the channel and the fragments", async () => {
    const handler = await boot({ post: makeStrandedPost() });

    const refusal = await refusalOfStart(
      handler,
      startRequest("publish-now", [TEST_CHANNEL_IDS[0]!, TEST_CHANNEL_IDS[1]!])
    );

    expect(refusal.statusCode).toBe(409);
    expect(refusal.code).toBe(ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS);
    expect(refusal.details).toEqual({
      channelId: TEST_CHANNEL_IDS[0],
      fragments: [{ index: 1, externalId: "frag-1" }],
    });
  });

  it("refuses 409 PUBLICATION_IN_FLIGHT naming the saga that holds the post", async () => {
    const lockStore = new InMemorySemanticLockStore();
    lockStore.plantHolder(`post-publishing:${TEST_EXISTING_DRAFT_POST_ID}`, "saga-in-flight");
    const handler = await boot({ lockStore });

    const refusal = await refusalOfStart(handler, startRequest("publish-now"));

    expect(refusal.statusCode).toBe(409);
    expect(refusal.code).toBe(ErrorCode.PUBLICATION_IN_FLIGHT);
    expect(refusal.details).toEqual({ sagaId: "saga-in-flight" });
  });

  it("admits when the lock is free, so the read is a check and never an acquire", async () => {
    const lockStore = new InMemorySemanticLockStore();
    const handler = await boot({ lockStore });

    const result = await handler(startRequest("publish-now"), passthroughReply);

    expect(result.success).toBe(true);
    // Reading the holder must not take the lock: the route never becomes a saga, so a
    // key it acquired here would be released by nobody until the TTL lapsed.
    const held = await lockStore.holder(`post-publishing:${TEST_EXISTING_DRAFT_POST_ID}`);
    expect(held.ok && held.value).toBeNull();
  });

  it("admits a schedule for a post already SCHEDULED", async () => {
    const handler = await boot({ post: makeExistingPost(PublishStatus.scheduled()) });

    const result = await handler(startRequest("schedule"), passthroughReply);

    expect(result.success).toBe(true);
  });

  it("refuses a schedule for a post whose publication already ran", async () => {
    // Publish-now is the only re-drive route: a delayed re-drive would park a re-send
    // behind a timer nobody is watching.
    const handler = await boot({ post: makeStrandedPost() });

    const refusal = await refusalOfStart(handler, startRequest("schedule", [TEST_CHANNEL_IDS[1]!]));

    expect(refusal.statusCode).toBe(400);
  });

  it("still answers 404 for a channel outside the caller's project, before any record read", async () => {
    const handler = await boot({ post: makeFullyPublishedPost() });

    const refusal = await refusalOfStart(
      handler,
      startRequest("publish-now", ["88888888-8888-4888-8888-888888888888"])
    );

    expect(refusal.statusCode).toBe(404);
  });

  it("enqueues nothing when the start is refused", async () => {
    const handler = await boot({ post: makeFullyPublishedPost() });
    const queue = (integration as unknown as { config: { queue: MockQueue } }).config.queue;

    await refusalOfStart(handler, startRequest("publish-now"));

    // A status code alone would not notice a refusal that had already enqueued.
    expect(queue.enqueuedJobs).toHaveLength(0);
  });
});

describe("POST /sagas/post-publishing/start — a post that carries no record", () => {
  let integration: SagaIntegration;

  afterEach(async () => {
    await integration.shutdown();
  });

  it("refuses a publish-now for a PUBLISHED post with no record", async () => {
    // Every post published before the record existed carries none. Reading absence as
    // "never published" would re-send content that is already live.
    const built = await buildIntegration({ post: makeExistingPost(PublishStatus.published()) });
    integration = built.integration;
    const handler = built.routes.get("POST:/sagas/post-publishing/start");
    if (handler === undefined) {
      throw new Error("the start route is not registered");
    }

    const refusal = await refusalOfStart(handler, startRequest("publish-now"));

    expect(refusal.statusCode).toBe(400);
    expect(refusal.message).toMatch(/PUBLISHED/);
  });
});
