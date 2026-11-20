/**
 * @file authActions.test.ts
 * @description Pins the two Server Actions of the administrators' sign-in and required password
 *   change, through the real backend client with `fetch` as the stand-in API. The sign-in sends an
 *   administrator who must change the password to the change page of the active locale with
 *   nothing in the URL and no session, and still signs in and reports errors as before. The change
 *   sends the form's e-mail, current password, new password and second-factor code, never the
 *   confirmation, redirects to the sign-in with the changed flag, and otherwise returns the API's
 *   code, the fields a validation failure names, and whether the form asks for the code. Next's
 *   redirect, the locale, the inbound headers and the session cookies are stand-ins.
 * @layer infrastructure
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changeRequiredPasswordAction, loginAction } from "@/app/actions/auth";

const navigation = vi.hoisted(() => ({ redirects: [] as string[] }));
const session = vi.hoisted(() => ({ setAuthTokens: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    navigation.redirects.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("next-intl/server", () => ({ getLocale: async () => "es" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.4" }),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/auth/sessionCookie", () => ({
  CSRF_COOKIE_NAME: "admin-csrf",
  SESSION_COOKIE_NAME: "admin-session",
  setAuthTokens: session.setAuthTokens,
  clearAuthCookies: vi.fn(),
}));

const EMAIL = "first.admin@omnipost.test";
const USER = { id: "admin-1", email: EMAIL, name: "first.admin", role: "SUPER_ADMIN" };
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
function answerWith(response: Response) {
  const fetchStub = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/** The JSON body of the one call `fetchStub` received. */
function sentBody(fetchStub: ReturnType<typeof answerWith>): unknown {
  expect(fetchStub).toHaveBeenCalledTimes(1);
  const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

/** A form's data holding the given fields. */
function formOf(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
}

const CHANGE_FORM = {
  email: EMAIL,
  currentPassword: "single-use-secret",
  newPassword: "N3w-Passphrase!x",
  confirmPassword: "N3w-Passphrase!x",
};

beforeEach(() => {
  navigation.redirects.length = 0;
  session.setAuthTokens.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loginAction", () => {
  it("sends an administrator who must change the password to the change page, with nothing in the URL and no session", async () => {
    answerWith(jsonAnswer(403, { ok: false, error: "PASSWORD_CHANGE_REQUIRED" }));

    await expect(loginAction(null, formOf({ email: EMAIL, password: "secret" }))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(navigation.redirects).toEqual(["/es/login/change-password"]);
    expect(session.setAuthTokens).not.toHaveBeenCalled();
  });

  it("still opens the session and goes to the dashboard after a sign-in", async () => {
    answerWith(jsonAnswer(200, { ok: true, data: { user: USER, tokens: TOKENS } }));

    await expect(loginAction(null, formOf({ email: EMAIL, password: "secret" }))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(session.setAuthTokens).toHaveBeenCalledWith({
      accessToken: "access",
      refreshToken: "refresh",
      csrfToken: "csrf",
    });
    expect(navigation.redirects).toEqual(["/es"]);
  });

  it("still returns the API's code for wrong credentials, with no redirect", async () => {
    answerWith(jsonAnswer(401, { ok: false, error: "INVALID_CREDENTIALS" }));

    const state = await loginAction(null, formOf({ email: EMAIL, password: "wrong" }));

    expect(state).toEqual({ error: "INVALID_CREDENTIALS" });
    expect(navigation.redirects).toEqual([]);
    expect(session.setAuthTokens).not.toHaveBeenCalled();
  });
});

describe("changeRequiredPasswordAction", () => {
  it("sends the form's e-mail, current password and new password, never the confirmation", async () => {
    const fetchStub = answerWith(jsonAnswer(200, { ok: true, data: { message: "changed" } }));

    await expect(changeRequiredPasswordAction(null, formOf(CHANGE_FORM))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(sentBody(fetchStub)).toEqual({
      email: EMAIL,
      currentPassword: "single-use-secret",
      newPassword: "N3w-Passphrase!x",
    });
  });

  it("sends the second factor's code once the form holds it", async () => {
    const fetchStub = answerWith(jsonAnswer(200, { ok: true, data: { message: "changed" } }));

    await expect(
      changeRequiredPasswordAction(null, formOf({ ...CHANGE_FORM, mfaToken: "654321" }))
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(sentBody(fetchStub)).toEqual({
      email: EMAIL,
      currentPassword: "single-use-secret",
      newPassword: "N3w-Passphrase!x",
      mfaToken: "654321",
    });
  });

  it("redirects to the sign-in of the locale with the changed flag after a change", async () => {
    answerWith(jsonAnswer(200, { ok: true, data: { message: "changed" } }));

    await expect(changeRequiredPasswordAction(null, formOf(CHANGE_FORM))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(navigation.redirects).toEqual(["/es/login?passwordChanged=1"]);
    expect(session.setAuthTokens).not.toHaveBeenCalled();
  });

  it("returns the API's code when the change is refused, with no redirect", async () => {
    answerWith(jsonAnswer(400, { ok: false, error: "PASSWORD_REUSED" }));

    const state = await changeRequiredPasswordAction(null, formOf(CHANGE_FORM));

    expect(state).toEqual({ error: "PASSWORD_REUSED" });
    expect(navigation.redirects).toEqual([]);
  });

  it("asks for the second factor's code when the API requires it", async () => {
    answerWith(jsonAnswer(401, { ok: false, error: "MFA_REQUIRED" }));

    const state = await changeRequiredPasswordAction(null, formOf(CHANGE_FORM));

    expect(state).toEqual({ error: "MFA_REQUIRED", requiresMfa: true });
  });

  it("keeps asking for the code once the form holds it, whatever the API refuses", async () => {
    answerWith(jsonAnswer(401, { ok: false, error: "MFA_INVALID" }));

    const state = await changeRequiredPasswordAction(
      null,
      formOf({ ...CHANGE_FORM, mfaToken: "000000" })
    );

    expect(state).toEqual({ error: "MFA_INVALID", requiresMfa: true });
  });

  it("returns the fields a validation failure names", async () => {
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

    const state = await changeRequiredPasswordAction(null, formOf(CHANGE_FORM));

    expect(state).toEqual({ error: "Validation failed", invalidFields: ["email", "newPassword"] });
  });
});
