/**
 * @file gatewaySwitchesDates.test.tsx
 * @description Pins the dates, times and texts of the gateway-switches page to the active UI
 *   locale: the table's requested and scheduled columns, the detail dialog's timeline and
 *   deadline, and the extend dialog's current and new deadline read in Spanish under `es` and keep
 *   the English text they had when the page named `en-US` under `en`; the statistics region's
 *   accessible name and the extend dialog's hour options read their catalog text. The data hooks
 *   and next-intl's navigation are stand-ins. Dates are built from local wall-clock parts, so the
 *   assertions hold in any time zone the suite runs in.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes } from "react";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import GatewaySwitchesPage from "@/app/[locale]/(dashboard)/billing/gateway-switches/page";
import type { GatewaySwitchEvent } from "@/hooks/api/useGatewaySwitches";

const SWITCH: GatewaySwitchEvent = {
  id: "switch-1",
  accountId: "account-1",
  fromGateway: "STRIPE",
  toGateway: "PADDLE",
  requestedAt: new Date(2026, 9, 22, 14, 7).toISOString(),
  scheduledFor: new Date(2026, 9, 29, 14, 7).toISOString(),
  completedAt: null,
  cancelledAt: null,
  reminderSentAt: null,
  suspendedAt: null,
  extendedUntil: null,
  extendedBy: null,
  status: "SCHEDULED",
  metadata: null,
  account: { id: "account-1", name: "Acme", email: "billing@acme.test" },
};

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/api/useGatewaySwitches", () => ({
  useGatewaySwitches: () => ({
    data: {
      events: [SWITCH],
      total: 1,
      page: 1,
      limit: 50,
      stats: { scheduled: 1, pendingCheckout: 0, suspended: 0, completed30d: 0 },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGatewaySwitchDetail: () => ({ data: SWITCH, isLoading: false }),
  useExtendSwitchDeadline: () => ({ mutate: vi.fn(), isPending: false }),
  useForceCompleteSwitch: () => ({ mutate: vi.fn(), isPending: false }),
  useForceSuspendSwitch: () => ({ mutate: vi.fn(), isPending: false }),
}));

const CATALOGS = { en: enMessages, es: esMessages } as const;

function renderPage(locale: keyof typeof CATALOGS) {
  render(
    <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
      <GatewaySwitchesPage />
    </NextIntlClientProvider>
  );
}

/** Opens the detail dialog of the one switch and returns it. */
function openDetail(locale: keyof typeof CATALOGS): HTMLElement {
  fireEvent.click(
    screen.getByRole("button", { name: CATALOGS[locale].gatewaySwitches.actions.viewDetail })
  );
  return screen.getByRole("dialog", { name: CATALOGS[locale].gatewaySwitches.detail.title });
}

/** Opens the extend dialog from the detail dialog and returns it. */
function openExtend(locale: keyof typeof CATALOGS): HTMLElement {
  fireEvent.click(
    within(openDetail(locale)).getByRole("button", {
      name: CATALOGS[locale].gatewaySwitches.actions.extend,
    })
  );
  return screen.getByRole("dialog", { name: CATALOGS[locale].gatewaySwitches.extendDialog.title });
}

describe("gateway switches table", () => {
  it("shows the requested and scheduled dates in Spanish on the es interface", () => {
    renderPage("es");

    expect(screen.getByText("22 oct 2026, 14:07")).toBeInTheDocument();
    expect(screen.getByText("29 oct 2026, 14:07")).toBeInTheDocument();
  });

  it("keeps the English requested and scheduled dates on the en interface", () => {
    renderPage("en");

    expect(screen.getByText("Oct 22, 2026, 02:07 PM")).toBeInTheDocument();
    expect(screen.getByText("Oct 29, 2026, 02:07 PM")).toBeInTheDocument();
  });
});

describe("gateway switch detail dialog", () => {
  it("dates the timeline and the current deadline in Spanish on the es interface", () => {
    renderPage("es");

    const dialog = openDetail("es");

    expect(within(dialog).getByText("22 oct 2026, 14:07")).toBeInTheDocument();
    expect(within(dialog).getAllByText("29 oct 2026, 14:07")).toHaveLength(2);
  });

  it("keeps the English timeline and current deadline on the en interface", () => {
    renderPage("en");

    const dialog = openDetail("en");

    expect(within(dialog).getByText("Oct 22, 2026, 02:07 PM")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Oct 29, 2026, 02:07 PM")).toHaveLength(2);
  });
});

describe("gateway switch extend dialog", () => {
  it("shows the current and the 24-hour-later deadline in Spanish on the es interface", () => {
    renderPage("es");

    const dialog = openExtend("es");

    expect(within(dialog).getByText("29 oct 2026, 14:07")).toBeInTheDocument();
    expect(within(dialog).getByText("30 oct 2026, 14:07")).toBeInTheDocument();
  });

  it("keeps the English current and new deadline on the en interface", () => {
    renderPage("en");

    const dialog = openExtend("en");

    expect(within(dialog).getByText("Oct 29, 2026, 02:07 PM")).toBeInTheDocument();
    expect(within(dialog).getByText("Oct 30, 2026, 02:07 PM")).toBeInTheDocument();
  });
});

describe("gateway switches statistics region", () => {
  it("names the statistics region in Spanish on the es interface", () => {
    renderPage("es");

    expect(
      screen.getByRole("region", { name: "Estadísticas de cambios de gateway" })
    ).toBeInTheDocument();
  });

  it("keeps the English name of the statistics region on the en interface", () => {
    renderPage("en");

    expect(screen.getByRole("region", { name: "Gateway switch statistics" })).toBeInTheDocument();
  });
});

describe("gateway switch extend dialog hour options", () => {
  it("writes the extra hours the Spanish way on the es interface", () => {
    renderPage("es");

    const dialog = openExtend("es");

    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["12 h", "24 h", "48 h", "72 h"]);
  });

  it("keeps the English extra hours on the en interface", () => {
    renderPage("en");

    const dialog = openExtend("en");

    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["12h", "24h", "48h", "72h"]);
  });
});
