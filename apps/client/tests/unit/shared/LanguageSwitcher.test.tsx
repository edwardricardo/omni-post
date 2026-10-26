/**
 * @file LanguageSwitcher.test.tsx
 * @description Pins the dashboard's language menu to the routing: one item per locale
 *   `routing.locales` declares, each named in its own language with the first letter
 *   capitalised as a menu label, and the trigger named after the active locale. The
 *   three-locale case mocks the routing; next-intl's navigation is a stand-in.
 * @layer infrastructure
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn() }),
}));

/**
 * Renders a fresh copy of the switcher on `locale`, with the real routing or with one declaring
 * `locales`; the component reads the routing at module load, so each routing needs its own load.
 */
async function renderSwitcher(locale: string, locales?: readonly string[]) {
  vi.resetModules();
  if (locales) {
    vi.doMock("@/i18n/routing", () => ({ routing: { locales, defaultLocale: "en" } }));
  }
  const { NextIntlClientProvider } = await import("next-intl");
  const { LanguageSwitcher } = await import("@/components/shared/LanguageSwitcher");
  render(
    <NextIntlClientProvider locale={locale}>
      <LanguageSwitcher />
    </NextIntlClientProvider>
  );
}

/** Opens the menu from the keyboard, the path Radix's trigger handles without pointer events. */
function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
}

afterEach(() => {
  vi.doUnmock("@/i18n/routing");
  vi.resetModules();
});

describe("LanguageSwitcher", () => {
  it("names the trigger after the active locale in its own language", async () => {
    await renderSwitcher("es");

    expect(screen.getByRole("button")).toHaveAccessibleName("Español");
  });

  it("lists every routing locale under its own name", async () => {
    await renderSwitcher("es");

    openMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "English",
      "Español",
    ]);
  });

  it("marks each locale's name with its language, so a screen reader pronounces it in that language", async () => {
    await renderSwitcher("es");

    openMenu();

    const languages = screen
      .getAllByRole("menuitem")
      .map((item) => item.querySelector("[lang]")?.getAttribute("lang"));
    expect(languages).toEqual(["en", "es"]);
  });

  it("names a third routing locale in its own language, not by its code", async () => {
    await renderSwitcher("en", ["en", "es", "fr"]);

    openMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "English",
      "Español",
      "Français",
    ]);
  });
});
