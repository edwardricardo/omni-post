/**
 * @file authApiErrorBody.test.ts
 * @description How the client's authentication API turns a failed response's body into an
 *              `ApiError`: the API's problem body gives its code and its `detail`, never the
 *              endpoint's own fallback text, and a legacy body that carries both `error` and
 *              `message` keeps giving its `error`; a JSON body that is not an object gives the
 *              endpoint's fallback text. Exercised through MSW v2; the other legacy bodies are
 *              held by `lib/auth/__tests__/authApi.test.ts`.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { ApiError } from "@packages/api-errors";

import { authApi } from "../../lib/auth/authApi";
import { server } from "../mocks/server";

const AUTH_BASE = "/api/backend/auth/customer";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("authApi given the API's problem body", () => {
  it("rejects a sign-in with an ApiError carrying the problem's status, code and detail", async () => {
    server.use(
      http.post(`${AUTH_BASE}/login`, () =>
        HttpResponse.json(
          {
            type: "https://omnipost.app/problems/VALIDATION_FAILED",
            title: "Validation failed",
            status: 400,
            detail: "The request is not valid",
            code: "VALIDATION_FAILED",
            correlationId: "corr-002",
            timestamp: "2026-11-20T00:00:00.000Z",
            issues: [
              { part: "body", pointer: "/email", code: "invalid_format", detail: "Invalid email" },
            ],
          },
          { status: 400, headers: { "Content-Type": "application/problem+json; charset=utf-8" } }
        )
      )
    );

    const failure = await authApi.login({ email: "not-an-email", password: "x" }).then(
      () => undefined,
      (reason: unknown) => reason
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "The request is not valid",
    });
  });
});

describe("authApi given the rate limiter's legacy body", () => {
  it("rejects a sign-in with an ApiError whose message is the body's error, not its message", async () => {
    server.use(
      http.post(`${AUTH_BASE}/login`, () =>
        HttpResponse.json(
          {
            ok: false,
            error: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests, retry later",
            retryAfter: 30,
          },
          { status: 429 }
        )
      )
    );

    const failure = await authApi.login({ email: "a@b.com", password: "x" }).then(
      () => undefined,
      (reason: unknown) => reason
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 429, code: null, message: "RATE_LIMIT_EXCEEDED" });
  });
});

describe("authApi given a JSON body that is not an object", () => {
  it.each([
    ["a string", "upstream down"],
    ["a number", 42],
    ["null", null],
  ])(
    "rejects a sign-in with the endpoint's fallback text when the body is %s",
    async (_kind, body) => {
      server.use(http.post(`${AUTH_BASE}/login`, () => HttpResponse.json(body, { status: 502 })));

      const failure = await authApi.login({ email: "a@b.com", password: "x" }).then(
        () => undefined,
        (reason: unknown) => reason
      );

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ status: 502, code: null, message: "Login failed" });
    }
  );
});
