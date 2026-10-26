/**
 * @file SidebarNav.test.tsx
 * @description Pins the sidebar's language switcher to the routing: one button per locale
 *   `routing.locales` declares, labelled with its code, named for assistive tech with the
 *   target's name in the interface's language, the active one pressed; and its navigation
 *   labels to the catalog. The three-locale case mocks
 *   the routing; next-intl's navigation, the logout action and the theme are stand-ins.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/accounts",
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock("@/app/actions/auth", () => ({ logoutAction: vi.fn() }));

vi.mock("@/providers/ThemeProvider", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

const CATALOGS = { en: enMessages, es: esMessages } as const;

/**
 * Renders a fresh copy of the sidebar on `locale`, with the real routing or with one declaring
 * `locales`; the component reads the routing at module load, so each routing needs its own load.
 */
async function renderSidebar(locale: keyof typeof CATALOGS, locales?: readonly string[]) {
  vi.resetModules();
  if (locales) {
    vi.doMock("@/i18n/routing", () => ({ routing: { locales, defaultLocale: "en" } }));
  }
  const { NextIntlClientProvider } = await import("next-intl");
  const { SidebarNav } = await import("@/components/shared/SidebarNav");
  render(
    <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
      <SidebarNav />
    </NextIntlClientProvider>
  );
}

/** The language switcher's buttons, in document order: the only buttons carrying aria-pressed. */
function localeButtons(): HTMLElement[] {
  return screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed"));
}

beforeEach(() => {
  navigation.replace.mockReset();
});

afterEach(() => {
  vi.doUnmock("@/i18n/routing");
  vi.resetModules();
});

describe("SidebarNav labels", () => {
  it("labels the configuration group and its settings item from the catalog, never by their keys", async () => {
    await renderSidebar("en");
    // A group shows its items once it is open; none of the configuration group's items is active.
    fireEvent.click(screen.getByRole("button", { name: enMessages.nav.configuration }));

    expect(screen.getByText(enMessages.nav.configuration)).toBeTruthy();
    expect(screen.getByText(enMessages.nav.settings)).toBeTruthy();
    expect(screen.queryByText("configuration")).toBeNull();
    expect(screen.queryByText("settings")).toBeNull();
  });

  it("labels the gateway switches item from the catalog, never by its key", async () => {
    await renderSidebar("es");

    expect(screen.getByText(esMessages.nav.gatewaySwitches)).toBeTruthy();
    expect(screen.queryByText("gatewaySwitches")).toBeNull();
  });
});

describe("SidebarNav language switcher", () => {
  it("renders one button per routing locale, labelled with its code and named in the interface language", async () => {
    await renderSidebar("en");

    expect(localeButtons().map((button) => button.textContent)).toEqual(["EN", "ES"]);
    expect(screen.getByRole("button", { name: "Switch to English" })).toHaveTextContent("EN");
    expect(screen.getByRole("button", { name: "Switch to Spanish" })).toHaveTextContent("ES");
  });

  it("marks only the active locale's button as pressed", async () => {
    await renderSidebar("en");

    expect(screen.getByRole("button", { name: "Switch to English" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Switch to Spanish" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("names each target language inside the Spanish sentence on the Spanish interface", async () => {
    await renderSidebar("es");

    expect(screen.getByRole("button", { name: "Cambiar a inglés" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Cambiar a español" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("replaces the route with the chosen locale and ignores a click on the active one", async () => {
    await renderSidebar("en");

    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Spanish" }));

    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("/accounts", { locale: "es" });
  });

  it("renders a button for a third locale the routing declares", async () => {
    await renderSidebar("en", ["en", "es", "fr"]);

    expect(localeButtons().map((button) => button.textContent)).toEqual(["EN", "ES", "FR"]);
    expect(screen.getByRole("button", { name: "Switch to French" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
