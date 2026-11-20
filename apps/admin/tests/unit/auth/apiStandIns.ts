/**
 * @file apiStandIns.ts
 * @description The stand-in API the suites of the administrators' sign-in and required password
 *   change share: a JSON answer, a `fetch` that answers one response and records its calls, the
 *   reading of the one call it received, and an administrator with its tokens as the sign-in
 *   returns them.
 * @layer infrastructure
 */
import { expect, vi } from "vitest";

/** The e-mail address of the administrator the suites sign in or change the password of. */
export const ADMIN_EMAIL = "first.admin@omnipost.test";

/** The administrator a successful sign-in returns. */
export const ADMIN_USER = {
  id: "admin-1",
  email: ADMIN_EMAIL,
  name: "first.admin",
  role: "SUPER_ADMIN",
};

/** The tokens a successful sign-in returns. */
export const ADMIN_TOKENS = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 900,
  csrfToken: "csrf",
};

/**
 * @description Builds a JSON answer of the API.
 * @param status - The answer's HTTP status
 * @param body - The envelope, serialized as the answer's body
 * @returns The answer
 */
export function jsonAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * @description Replaces `fetch` with one that answers `response` and records its calls.
 * @param response - The answer, or a function that produces it (and may reject, as a request
 *   that never reaches the API does)
 * @returns The stand-in, whose calls the suite reads
 */
export function answerWith(response: Response | (() => Promise<Response>)) {
  const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) =>
    typeof response === "function" ? response() : response
  );
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/**
 * @description Reads the one call the stand-in received, and fails when it received another
 *   number of calls.
 * @param fetchStub - The stand-in `answerWith` installed
 * @returns The URL and the request options of the call
 */
export function onlyCall(fetchStub: ReturnType<typeof answerWith>): {
  url: URL;
  init: RequestInit;
} {
  expect(fetchStub).toHaveBeenCalledTimes(1);
  const [url, init] = fetchStub.mock.calls[0] ?? [];
  return { url: new URL(String(url)), init: init ?? {} };
}

/**
 * @description Reads the JSON body of the one call the stand-in received.
 * @param fetchStub - The stand-in `answerWith` installed
 * @returns The parsed body
 */
export function sentBody(fetchStub: ReturnType<typeof answerWith>): unknown {
  return JSON.parse(String(onlyCall(fetchStub).init.body));
}
