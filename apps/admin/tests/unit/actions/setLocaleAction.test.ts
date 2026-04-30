/**
 * @file setLocaleAction.test.ts
 * @description Unit tests for the locale Server Action — verifies the cookie
 *              is written with secure attributes for valid locales, that
 *              unsupported values are silently ignored, and that
 *              `revalidatePath` is invoked so Server Components re-render
 *              with the new translations.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const cookieSet = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: cookieSet }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

import { setLocaleAction } from "../../../app/actions/locale";

beforeEach(() => {
  cookieSet.mockReset();
  revalidatePath.mockReset();
});

describe("setLocaleAction", () => {
  it("writes the NEXT_LOCALE cookie with secure attributes for 'en'", async () => {
    await setLocaleAction("en");
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "en",
      expect.objectContaining({
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      })
    );
  });

  it("writes the cookie for 'es' as well", async () => {
    await setLocaleAction("es");
    expect(cookieSet).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "es",
      expect.objectContaining({ path: "/" })
    );
  });

  it("revalidates the root layout so Server Components re-render", async () => {
    await setLocaleAction("en");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("ignores unsupported locales without writing a cookie or revalidating", async () => {
    await setLocaleAction("fr" as never);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
