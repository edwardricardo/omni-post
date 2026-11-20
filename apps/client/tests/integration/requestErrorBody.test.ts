/**
 * @file requestErrorBody.test.ts
 * @description How the client's request helpers turn a failed response into an `ApiError`: the
 *              API's problem body gives its code and its `detail`, and the body of a route that
 *              still answers through a legacy helper keeps giving its `message`, its `error`,
 *              its `code` and its `details`. Exercised through MSW v2.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { ApiError } from "@packages/api-errors";

import { PROXY_BASE, request, uploadRequest } from "../../lib/api/clients/request";
import { server } from "../mocks/server";

const PROBLEM_MEDIA_TYPE = "application/problem+json; charset=utf-8";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const makeProblem = (overrides: Record<string, unknown> = {}) => ({
  type: "https://omnipost.app/problems/CONFLICT",
  title: "Conflict",
  status: 409,
  detail: "The request conflicts with the current state of the resource",
  code: "CONFLICT",
  correlationId: "corr-001",
  timestamp: "2026-11-20T00:00:00.000Z",
  ...overrides,
});

async function rejectionOf(pending: Promise<unknown>): Promise<ApiError> {
  const failure = await pending.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(failure).toBeInstanceOf(ApiError);
  return failure as ApiError;
}

describe("request given the API's problem body", () => {
  it("throws an ApiError with the problem's status, code and detail", async () => {
    server.use(
      http.get(`${PROXY_BASE}/channels/ch-1`, () =>
        HttpResponse.json(makeProblem(), {
          status: 409,
          headers: { "Content-Type": PROBLEM_MEDIA_TYPE },
        })
      )
    );

    const error = await rejectionOf(request(PROXY_BASE, "/channels/ch-1"));

    expect(error.status).toBe(409);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("The request conflicts with the current state of the resource");
    expect(error.details).toBeUndefined();
  });
});

describe("uploadRequest given the API's problem body", () => {
  it("throws an ApiError with the problem's status, code and detail", async () => {
    server.use(
      http.post(`${PROXY_BASE}/assets/upload`, () =>
        HttpResponse.json(
          makeProblem({
            type: "https://omnipost.app/problems/PAYLOAD_TOO_LARGE",
            title: "Payload too large",
            status: 413,
            detail: "The request body is larger than this route accepts",
            code: "PAYLOAD_TOO_LARGE",
          }),
          { status: 413, headers: { "Content-Type": PROBLEM_MEDIA_TYPE } }
        )
      )
    );

    const error = await rejectionOf(uploadRequest(PROXY_BASE, "/assets/upload", new FormData()));

    expect(error.status).toBe(413);
    expect(error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(error.message).toBe("The request body is larger than this route accepts");
  });
});

describe("request given a legacy route's error body", () => {
  it("throws an ApiError with the body's message, code and details", async () => {
    const details = [{ field: "name", message: "Required", code: "too_small" }];
    server.use(
      http.post(`${PROXY_BASE}/projects`, () =>
        HttpResponse.json(
          {
            ok: false,
            error: "Validation failed",
            message: "The project name is required",
            code: "VALIDATION_ERROR",
            details,
          },
          { status: 400 }
        )
      )
    );

    const error = await rejectionOf(request(PROXY_BASE, "/projects", { method: "POST" }));

    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("The project name is required");
    expect(error.details).toEqual(details);
  });

  it("throws an ApiError whose message is the body's error when it carries no message", async () => {
    server.use(
      http.get(`${PROXY_BASE}/channels/ch-2`, () =>
        HttpResponse.json({ ok: false, error: "Channel not found" }, { status: 404 })
      )
    );

    const error = await rejectionOf(request(PROXY_BASE, "/channels/ch-2"));

    expect(error.status).toBe(404);
    expect(error.code).toBeNull();
    expect(error.message).toBe("Channel not found");
  });

  it("throws an ApiError naming the status when the body is not JSON", async () => {
    server.use(
      http.get(
        `${PROXY_BASE}/health`,
        () => new HttpResponse("upstream down", { status: 502, statusText: "Bad Gateway" })
      )
    );

    const error = await rejectionOf(request(PROXY_BASE, "/health"));

    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.message).toBe("HTTP 502: Bad Gateway");
  });
});

describe("request given a JSON body that is not an object", () => {
  it.each([
    ["a string", "upstream down"],
    ["a number", 42],
    ["null", null],
  ])("throws an ApiError naming the status when the body is %s", async (_kind, body) => {
    server.use(
      http.get(`${PROXY_BASE}/health`, () =>
        HttpResponse.json(body, { status: 502, statusText: "Bad Gateway" })
      )
    );

    const error = await rejectionOf(request(PROXY_BASE, "/health"));

    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.message).toBe("HTTP 502: Bad Gateway");
  });
});

describe("uploadRequest given a legacy route's error body", () => {
  it("throws an ApiError with the body's error when it carries no message", async () => {
    server.use(
      http.post(`${PROXY_BASE}/assets/upload`, () =>
        HttpResponse.json({ ok: false, error: "Unsupported file type" }, { status: 415 })
      )
    );

    const error = await rejectionOf(uploadRequest(PROXY_BASE, "/assets/upload", new FormData()));

    expect(error.status).toBe(415);
    expect(error.code).toBeNull();
    expect(error.message).toBe("Unsupported file type");
  });
});
