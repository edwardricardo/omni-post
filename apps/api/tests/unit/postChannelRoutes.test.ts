/**
 * @file postChannelRoutes.test.ts
 * @description The customer's exit from a stranded channel, wired end to end at the
 *              route: `POST /posts/:postId/channels/:channelId/retraction/confirm-removed`.
 *              The use case's own branches are proved in `@core/posts`; what is proved
 *              here is the TRANSLATION — that a channel the post never declared answers
 *              404, that the `NOTHING_PENDING` refusal reaches the customer as a
 *              discriminator they can switch on rather than a sentence they must parse,
 *              and that a duplicate submit of their own confirmation is a 200 and not a
 *              conflict. A route that read the refusal by message would pass the use
 *              case's suite and fail here.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ok, err, ErrorCode } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { RETRACTION_REFUSALS, RetractionRefusalError } from "@core/posts/retractionRefusals.js";
import type {
  ConfirmManualRetractionInput,
  ConfirmManualRetractionOutput,
} from "@core/posts/ConfirmManualRetractionUseCase.js";
import { postChannelRoutes } from "../../src/posts/postChannelRoutes.js";
import { postRoutes } from "../../src/posts/postRoutes.js";
import { createErrorHandler } from "../../src/lib/errors/errorHandler.js";

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    request.customerUser ??= {
      id: "11111111-1111-4111-8111-111111111111",
      accountId: "22222222-2222-4222-8222-222222222222",
    };
  },
}));

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

/**
 * Every code the WIRE vocabulary declares. Read once, as strings, so a case can ask
 * whether a value that travelled is a member of it — which `toBe(refusal)` alone cannot,
 * because comparing two strings is satisfied by a mapping cast to a code `ErrorCode`
 * never declared.
 */
const WIRE_CODES: readonly string[] = Object.values(ErrorCode);

const POST_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CHANNEL_ID = "55555555-5555-4555-8555-555555555555";
const CONFIRM_URL = `/posts/${POST_ID}/channels/${CHANNEL_ID}/retraction/confirm-removed`;

/**
 * The failure arm admits a REALM-FOREIGN shape beside the real error class: a refusal
 * that reached this process as data — deserialized across a worker boundary, or built by
 * a duplicate instance of `@core/application` — is structurally the refusal and is not
 * this realm's `Error`. The route must answer it identically, which is the whole reason
 * `refusalOf` reads a string instead of comparing constructors.
 */
type RealmForeignRefusal = { code: string; message: string; refusal: string };

type ConfirmAnswer =
  | { kind: "ok"; applied: boolean; hasLiveContent: boolean }
  | { kind: "err"; error: UseCaseError | RealmForeignRefusal };

/** Every input the route handed the use case, so a case can prove it stopped earlier. */
const calls: ConfirmManualRetractionInput[] = [];
let answer: ConfirmAnswer = { kind: "ok", applied: true, hasLiveContent: false };

const useCaseDouble = {
  async execute(input: ConfirmManualRetractionInput) {
    calls.push(input);
    if (answer.kind === "err") {
      return err(answer.error);
    }
    const output: ConfirmManualRetractionOutput = {
      postId: input.postId,
      projectId: PROJECT_ID,
      channelId: input.channelId,
      applied: answer.applied,
      hasLiveContent: answer.hasLiveContent,
      status: "PARTIALLY_PUBLISHED",
    };
    return ok(output);
  },
};

/**
 * @function buildApp
 * @description A Fastify instance carrying the real plugin, the real global error
 *              handler and a container that answers with the double. The error handler
 *              is REAL on purpose: the discriminator this route exists to publish is on
 *              the wire only because that handler puts `code` there.
 * @returns The ready instance.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("container", { resolve: () => useCaseDouble } as never);
  app.setErrorHandler(createErrorHandler(app.log));
  await app.register(postChannelRoutes);
  await app.ready();
  return app;
}

describe("POST /posts/:postId/channels/:channelId/retraction/confirm-removed", () => {
  beforeEach(() => {
    calls.length = 0;
    answer = { kind: "ok", applied: true, hasLiveContent: false };
  });

  it("records the confirmation and answers what the customer needs to know next", async () => {
    answer = { kind: "ok", applied: true, hasLiveContent: false };
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.applied).toBe(true);
    expect(body.data.hasLiveContent).toBe(false);
    expect(body.data.channelId).toBe(CHANNEL_ID);
    expect(calls).toEqual([{ postId: POST_ID, channelId: CHANNEL_ID }]);
    await app.close();
  });

  it("answers a duplicate submit of the SAME confirmation with 200 and applied:false", async () => {
    answer = { kind: "ok", applied: false, hasLiveContent: false };
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.applied).toBe(false);
    await app.close();
  });

  it("answers 404 for a channel this post never declared", async () => {
    answer = {
      kind: "err",
      error: new UseCaseError(
        `channel ${CHANNEL_ID} is not part of post ${POST_ID}`,
        USE_CASE_ERRORS.NOT_FOUND
      ),
    };
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("answers NOTHING_PENDING as a 409 the customer branches on by CODE, not by message", async () => {
    answer = {
      kind: "err",
      error: new RetractionRefusalError(
        "channel holds no live content pending retraction",
        RETRACTION_REFUSALS.NOTHING_PENDING
      ),
    };
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    // Pinned against the LITERAL first: a comparison between two members that do not
    // exist yet passes vacuously, which is the trap `1c-2b` recorded on this shape.
    expect(body.error.code).toBe("NOTHING_PENDING");
    expect(body.error.code).toBe(ErrorCode.NOTHING_PENDING);
    await app.close();
  });

  it("keeps the discriminator on a refusal that is not this realm's Error, because the read is by VALUE", async () => {
    // `refusalOf` compares a string rather than a constructor, so a refusal that arrives
    // as data still carries its discriminator. A route that gated that read behind
    // `instanceof` would cancel the guarantee and answer the coarse conflict — which is
    // exactly what makes the difference invisible: the status code stays 409 and only
    // the field a caller branches on changes.
    answer = {
      kind: "err",
      error: {
        code: USE_CASE_ERRORS.CONFLICT,
        message: "channel holds no live content pending retraction",
        refusal: RETRACTION_REFUSALS.NOTHING_PENDING,
      },
    };
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.NOTHING_PENDING);
    await app.close();
  });

  it("publishes EVERY declared retraction refusal as its own wire code, not a flat conflict", async () => {
    // Exhaustiveness at the translation, driven from the declared set rather than from
    // a list written here: a refusal added to `RETRACTION_REFUSALS` that the route does
    // not map falls through to the coarse 409 and the discriminator is lost, which is
    // the one defect this whole chain exists to prevent. `CHANNEL_HAS_LIVE_FRAGMENTS`
    // is unreachable from `ConfirmManualRetractionUseCase` today (it only emits
    // `NOTHING_PENDING`), so the double is what hands it over — the subject is the
    // route's translation, which must not depend on which use case happens to call it.
    for (const refusal of Object.values(RETRACTION_REFUSALS)) {
      answer = {
        kind: "err",
        error: new RetractionRefusalError(`refused: ${refusal}`, refusal),
      };
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: CONFIRM_URL });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code, refusal).toBe(refusal);
      // …and that the code which travelled is one the wire vocabulary OWNS. The line
      // above compares two strings, which a mapping written as `"FOO" as ErrorCode`
      // satisfies while publishing a code no client can find in the enum. This is the
      // half that refuses the cast.
      expect(WIRE_CODES, refusal).toContain(JSON.parse(res.body).error.code);
      await app.close();
    }
  });

  it("keeps the wire code and the application discriminator spelled the same", () => {
    // Two declarations are unavoidable: `RETRACTION_REFUSALS` owns the application
    // vocabulary, `ErrorCode` owns the wire one, and `@shared/types` must not import
    // `@core/posts`. A TypeScript string enum is nominal, so no annotation can bind
    // them — this case is the binding. Driven from the refusal SET rather than naming
    // one member: a refusal whose wire code was never declared is the miss that the
    // mapping's `Record` cannot catch, because the compiler will accept any existing
    // `ErrorCode` — or a cast — in its place.
    for (const refusal of Object.values(RETRACTION_REFUSALS)) {
      expect(WIRE_CODES, refusal).toContain(String(refusal));
    }
  });

  it("answers a conflict that is NOT a retraction refusal with a flat 409", async () => {
    answer = {
      kind: "err",
      error: new UseCaseError("the post moved on", USE_CASE_ERRORS.CONFLICT),
    };
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.RESOURCE_CONFLICT);
    await app.close();
  });

  it("is reachable through the post routes plugin, which is what registers it", async () => {
    // The plugin registration is one production line that nothing else pins: a route
    // file that is never registered answers 404 from the ROUTER while every case above
    // keeps passing, because they mount it directly.
    const app = Fastify({ logger: false });
    app.decorate("container", { resolve: () => useCaseDouble } as never);
    app.setErrorHandler(createErrorHandler(app.log));
    await app.register(postRoutes);
    await app.ready();

    const res = await app.inject({ method: "POST", url: CONFIRM_URL });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("refuses a malformed identifier before the use case is reached, so a bad request writes nothing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/posts/not-a-uuid/channels/${CHANNEL_ID}/retraction/confirm-removed`,
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await app.close();
  });
});
