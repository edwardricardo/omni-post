/**
 * @file backendClient.test.ts
 * @description Pins how the portal's backend client reads the API's answers to the sign-in and to
 *   the required password change: what it sends, with the caller's address relayed, and the result
 *   it hands back for every answer the API gives. An error comes back as a code in text whether the
 *   API sent it as a string or as an object with a code; a validation failure keeps its issues; a
 *   body that is not JSON and a request that never reached the API come back as the portal's own
 *   code. `fetch` and the inbound request headers are stand-ins.
 * @layer infrastructure
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdmin, changeRequiredPassword } from "@/lib/auth/backend-client";
import { ADMIN_AUTH_ERROR } from "@/lib/auth/types";

const CLIENT_CHAIN = "203.0.113.7, 10.0.0.1";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));

const CHANGE_INPUT = {
  email: "first.admin@omnipost.test",
  currentPassword: "single-use-secret",
  newPassword: "N3w-Passphrase!x",
  mfaToken: "123456",
};

const USER = {
  id: "admin-1",
  email: "first.admin@omnipost.test",
  name: "first.admin",
  role: "SUPER_ADMIN",
};
const TOKENS = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 900,
  csrfToken: "csrf",
};

/** A JSON answer with the given status. */
function jsonAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Replaces `fetch` with one that answers `response` and records its calls. */
function answerWith(response: Response | (() => Promise<Response>)) {
  const fetchStub = vi.fn(async () => (typeof response === "function" ? response() : response));
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/** The URL and the request options of the one call `fetchStub` received. */
function onlyCall(fetchStub: ReturnType<typeof answerWith>): { url: URL; init: RequestInit } {
  expect(fetchStub).toHaveBeenCalledTimes(1);
  const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
  return { url: new URL(url), init };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticateAdmin", () => {
  it("reports an administrator who must change the password as its own result", async () => {
    answerWith(jsonAnswer(403, { ok: false, error: "PASSWORD_CHANGE_REQUIRED" }));

    const result = await authenticateAdmin({ email: USER.email, password: "secret" });

    expect(result).toEqual({ status: "password_change_required" });
  });

  it("answers the route limiter's 429, whose error is an object, with its code as text", async () => {
    answerWith(
      jsonAnswer(429, {
        ok: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again in 42 seconds.",
        },
      })
    );

    const result = await authenticateAdmin({ email: USER.email, password: "secret" });

    expect(result).toEqual({ status: "error", error: "RATE_LIMIT_EXCEEDED" });
  });

  it("answers a body that is not JSON with the portal's own code", async () => {
    answerWith(new Response("<html>Bad gateway</html>", { status: 502 }));

    const result = await authenticateAdmin({ email: USER.email, password: "secret" });

    expect(result).toEqual({ status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR });
  });

  it("still answers wrong credentials with the API's code", async () => {
    answerWith(jsonAnswer(401, { ok: false, error: "INVALID_CREDENTIALS" }));

    const result = await authenticateAdmin({ email: USER.email, password: "wrong" });

    expect(result).toEqual({ status: "error", error: "INVALID_CREDENTIALS" });
  });

  it("still signs in with the user and the tokens, relaying the caller's address", async () => {
    const fetchStub = answerWith(
      jsonAnswer(200, { ok: true, data: { user: USER, tokens: TOKENS } })
    );

    const result = await authenticateAdmin({ email: USER.email, password: "secret" });

    expect(result).toEqual({ status: "success", user: USER, tokens: TOKENS });
    const { url, init } = onlyCall(fetchStub);
    expect(url.pathname).toBe("/admin/auth/login");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-forwarded-for": CLIENT_CHAIN,
    });
  });

  it("still asks for the second factor when the API answers that it is required", async () => {
    answerWith(jsonAnswer(200, { ok: true, data: { requiresMfa: true } }));

    const result = await authenticateAdmin({ email: USER.email, password: "secret" });

    expect(result).toEqual({ status: "mfa_required", mfaSessionToken: "" });
  });
});

describe("changeRequiredPassword", () => {
  it("posts exactly the four fields to the endpoint, relaying the caller's address", async () => {
    const fetchStub = answerWith(
      jsonAnswer(200, {
        ok: true,
        data: { message: "Password changed. Sign in with the new password." },
      })
    );

    await changeRequiredPassword(CHANGE_INPUT);

    const { url, init } = onlyCall(fetchStub);
    expect(url.pathname).toBe("/admin/auth/password/change-required");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-forwarded-for": CLIENT_CHAIN,
    });
    expect(JSON.parse(String(init.body))).toEqual(CHANGE_INPUT);
  });

  it("leaves the second factor's code out of the body when none was given", async () => {
    const fetchStub = answerWith(jsonAnswer(200, { ok: true, data: { message: "changed" } }));
    const { mfaToken: _mfaToken, ...withoutCode } = CHANGE_INPUT;

    await changeRequiredPassword(withoutCode);

    const { init } = onlyCall(fetchStub);
    expect(JSON.parse(String(init.body))).toEqual(withoutCode);
  });

  it("answers the API's success as a changed password", async () => {
    answerWith(jsonAnswer(200, { ok: true, data: { message: "Password changed." } }));

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "changed" });
  });

  it("does not count a 200 whose body is not the API's envelope as a change", async () => {
    answerWith(
      new Response("<html>Signed out</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR });
  });

  it("does not count a 200 whose envelope is not ok as a change", async () => {
    answerWith(jsonAnswer(200, { ok: false }));

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR });
  });

  it.each([
    [401, "INVALID_CREDENTIALS"],
    [401, "MFA_INVALID"],
    [401, "MFA_REQUIRED"],
    [403, "ACCOUNT_LOCKED"],
    [403, "ACCOUNT_INACTIVE"],
    [409, "PASSWORD_CHANGE_NOT_REQUIRED"],
    [409, "CONCURRENT_MODIFICATION"],
    [400, "PASSWORD_TOO_WEAK"],
    [400, "PASSWORD_REUSED"],
    [429, "RATE_LIMIT_EXCEEDED"],
  ])("answers a %i with the code %s as an error", async (status, code) => {
    answerWith(jsonAnswer(status, { ok: false, error: code }));

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: code });
  });

  it("answers the route limiter's 429, whose error is an object, with its code as text", async () => {
    answerWith(
      jsonAnswer(429, {
        ok: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again in 7 seconds.",
        },
      })
    );

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: "RATE_LIMIT_EXCEEDED" });
  });

  it("answers the IP allowlist's 403, whose error is an object, with its code as text", async () => {
    answerWith(
      jsonAnswer(403, {
        ok: false,
        error: { code: "IP_NOT_ALLOWED", message: "Access denied: IP not in allowlist" },
      })
    );

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: "IP_NOT_ALLOWED" });
  });

  it("keeps the issues of a validation failure", async () => {
    answerWith(
      jsonAnswer(400, {
        ok: false,
        error: "Validation failed",
        details: {
          issues: [
            { path: "email", message: "Invalid email format" },
            { path: "newPassword", message: "Password must not exceed 128 characters" },
          ],
        },
      })
    );

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({
      status: "error",
      error: ADMIN_AUTH_ERROR.VALIDATION_FAILED,
      issues: [
        { path: "email", message: "Invalid email format" },
        { path: "newPassword", message: "Password must not exceed 128 characters" },
      ],
    });
  });

  it("answers a body that is not JSON with the portal's own code", async () => {
    answerWith(new Response("<html>Bad gateway</html>", { status: 502 }));

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR });
  });

  it("answers an error envelope that names no code with the portal's own code", async () => {
    answerWith(jsonAnswer(500, { ok: false, error: { message: "Internal Server Error" } }));

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR });
  });

  it("answers a request that never reached the API with the portal's own code", async () => {
    answerWith(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await changeRequiredPassword(CHANGE_INPUT);

    expect(result).toEqual({ status: "error", error: ADMIN_AUTH_ERROR.UNKNOWN_ERROR });
  });
});
