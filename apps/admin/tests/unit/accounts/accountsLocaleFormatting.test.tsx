/**
 * @file accountsLocaleFormatting.test.tsx
 * @description Pins the dates and texts of the accounts page and of the account billing panel to
 *   the active UI locale: the creation and last-login dates of the table, and the panel's
 *   grandfathering end, last login, trial end and session dates, read in Spanish under `es` and
 *   keep the English text they had under `en`; the table's accessible name, the row checkbox's
 *   name, the missing plan, the load error, the bulk-action, edit, create and export messages, the
 *   grandfathering badge, the bundle comparison and the missing session address read their catalog
 *   text. It also pins that a failed settings save is reported as an error. The data hooks, the
 *   CSV export, the toast, `fetch`, the current user and next-intl's navigation are stand-ins.
 *   Dates are built from local wall-clock parts, so the assertions hold in any time zone the
 *   suite runs in.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import AccountsPage from "@/app/[locale]/(dashboard)/accounts/page";
import { AccountBillingPanel } from "@/components/accounts/AccountBillingPanel";
import type { AccountSummary } from "@/lib/api/types";
import type { BillingData } from "@/hooks/api/useAccountBilling";

const OCT_20 = new Date(2026, 9, 20, 14, 7).toISOString();
const OCT_22 = new Date(2026, 9, 22, 14, 7).toISOString();
const OCT_29 = new Date(2026, 9, 29, 14, 7).toISOString();
const NOV_30 = new Date(2026, 10, 30, 14, 7).toISOString();

const ACCOUNT: AccountSummary = {
  id: "account-1",
  email: "billing@acme.test",
  name: "Acme",
  isActive: true,
  createdAt: OCT_22,
  lastLoginAt: OCT_29,
  plan: { type: "custom", name: "Growth", status: "ACTIVE", providers: ["x"], pricePerMonth: 30 },
  trial: { isOnTrial: false, trialDaysRemaining: 0, trialExpired: false },
  usage: { projectsUsed: 1, projectsRemaining: 4, utilizationPercent: 20 },
};

const PLANLESS: AccountSummary = {
  id: "account-2",
  email: "owner@globex.test",
  name: "Globex",
  isActive: true,
  createdAt: OCT_20,
  lastLoginAt: null,
  plan: { type: "none", name: "", status: "ACTIVE", providers: [], pricePerMonth: 0 },
  trial: { isOnTrial: false, trialDaysRemaining: 0, trialExpired: false },
  usage: { projectsUsed: 0, projectsRemaining: 5, utilizationPercent: 0 },
};

const BILLING: BillingData = {
  accountId: "account-1",
  accountName: "Acme",
  planType: "custom",
  bundleInfo: null,
  isGrandfathered: true,
  grandfathering: {
    lockedPrice: 20,
    currentListPrice: 30,
    savingsFromGrandfathering: 10,
    expiresAt: NOV_30,
  },
  providers: [],
  calculation: {
    providerCount: 1,
    accountCount: 1,
    basePrice: 30,
    totalMonthly: 30,
    listPrice: 30,
    savings: 0,
  },
  cheaperBundle: {
    bundle: { name: "Growth Bundle", slug: "growth" },
    bundleTotal: 25,
    customTotal: 30,
    savings: 5,
  },
  trial: { isOnTrial: true, trialEndDate: OCT_29, daysRemaining: 3 },
};

const accounts = vi.hoisted(() => ({ error: null as Error | null }));
/** The billing data the panel reads; each test starts from `BILLING`. */
const billing = vi.hoisted(() => ({ data: null as BillingData | null }));
const toast = vi.hoisted(() => vi.fn());
const exportAccountsToCSV = vi.hoisted(() => vi.fn());

vi.mock("@packages/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@packages/ui")>()),
  toast,
}));

vi.mock("@/components/accounts/exportAccountsToCSV", () => ({ exportAccountsToCSV }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/providers/AuthProvider", () => ({
  useCurrentUser: () => ({ hasPermission: () => true }),
}));

vi.mock("@/hooks/api/useAccounts", () => ({
  useAccounts: () =>
    accounts.error
      ? { data: undefined, isLoading: false, error: accounts.error, refetch: vi.fn() }
      : { data: [ACCOUNT, PLANLESS], isLoading: false, error: null, refetch: vi.fn() },
  useUpdateAccount: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
  }),
}));

vi.mock("@/hooks/api/useResetAccountPassword", () => ({
  useResetAccountPassword: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/api/useAccountBilling", () => ({
  useAccountBilling: () => ({ data: billing.data, isLoading: false, error: null }),
}));

vi.mock("@/hooks/api/useAccountSessions", () => ({
  useAccountSessions: () => ({
    data: [
      {
        id: "session-1",
        userId: "user-1",
        ipAddress: "203.0.113.7",
        userAgent: "Firefox",
        isActive: true,
        expiresAt: NOV_30,
        createdAt: OCT_20,
      },
      {
        id: "session-2",
        userId: "user-1",
        ipAddress: null,
        userAgent: null,
        isActive: true,
        expiresAt: NOV_30,
        createdAt: OCT_22,
      },
    ],
  }),
  useRevokeAccountSessions: () => ({ mutate: vi.fn(), isPending: false }),
}));

const CATALOGS = { en: enMessages, es: esMessages } as const;

/** Renders `ui` inside a query client and next-intl's provider on `locale`, with its catalog. */
function renderIn(locale: keyof typeof CATALOGS, ui: ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderPanel(locale: keyof typeof CATALOGS) {
  renderIn(locale, <AccountBillingPanel accountId="account-1" lastLoginAt={OCT_22} />);
}

/** A `fetch` stand-in that answers every request with `response`. */
function answerFetch(response: { ok: boolean; status?: number; body?: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body ?? {},
      text: async () => "",
    }))
  );
}

/** Selects the first account's row and runs the bulk action whose button reads `action`. */
function runBulkAction(locale: keyof typeof CATALOGS, action: string): void {
  renderIn(locale, <AccountsPage />);
  const select = CATALOGS[locale].accounts.selectAccount.replace("{email}", ACCOUNT.email);
  fireEvent.click(screen.getByRole("checkbox", { name: select }));
  fireEvent.click(screen.getByRole("button", { name: action }));
}

/** Opens the first account's edit form and saves it. */
function saveEdit(locale: keyof typeof CATALOGS): void {
  renderIn(locale, <AccountsPage />);
  const edit = CATALOGS[locale].accounts.actions.editAccount.replace("{email}", ACCOUNT.email);
  fireEvent.click(screen.getByRole("button", { name: edit }));
  fireEvent.click(screen.getByRole("button", { name: CATALOGS[locale].common.save }));
}

/** Opens the create form, fills it and submits it. */
function createAccount(locale: keyof typeof CATALOGS): void {
  renderIn(locale, <AccountsPage />);
  const catalog = CATALOGS[locale];
  fireEvent.click(screen.getByRole("button", { name: catalog.accounts.createAccount }));
  fireEvent.change(screen.getByLabelText(catalog.common.name), { target: { value: "Initech" } });
  fireEvent.change(screen.getByLabelText(catalog.common.email), {
    target: { value: "ops@initech.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: catalog.common.create }));
}

beforeEach(() => {
  billing.data = BILLING;
  vi.clearAllMocks();
  accounts.error = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("accounts table dates", () => {
  it("shows the creation and last-login dates in Spanish on the es interface", () => {
    renderIn("es", <AccountsPage />);

    expect(screen.getByText("Creada el 22 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("29 oct 2026")).toBeInTheDocument();
  });

  it("keeps the English creation and last-login dates on the en interface", () => {
    renderIn("en", <AccountsPage />);

    expect(screen.getByText("Created Oct 22, 2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 29, 2026")).toBeInTheDocument();
  });
});

describe("AccountBillingPanel dates", () => {
  it("shows the grandfathering end, last login, trial end and session dates in Spanish on the es interface", () => {
    renderPanel("es");

    expect(screen.getByText("Precio anterior hasta el 30/11/2026")).toBeInTheDocument();
    expect(screen.getByText("22 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Termina el 29/10/2026")).toBeInTheDocument();
    expect(screen.getByText("20/10/2026")).toBeInTheDocument();
  });

  it("keeps the English grandfathering end, last login, trial end and session dates on the en interface", () => {
    renderPanel("en");

    expect(screen.getByText("Grandfathered until 11/30/2026")).toBeInTheDocument();
    expect(screen.getByText("Oct 22, 2026")).toBeInTheDocument();
    expect(screen.getByText("Ends 10/29/2026")).toBeInTheDocument();
    expect(screen.getByText("10/20/2026")).toBeInTheDocument();
  });

  it("labels a grandfathered price with no end date on the en interface", () => {
    billing.data = {
      ...BILLING,
      grandfathering: {
        lockedPrice: 20,
        currentListPrice: 30,
        savingsFromGrandfathering: 10,
        expiresAt: null,
      },
    };

    renderPanel("en");
    expect(screen.getByText("Grandfathered")).toBeInTheDocument();
  });

  it("labels a grandfathered price with no end date in Spanish on the es interface", () => {
    billing.data = {
      ...BILLING,
      grandfathering: {
        lockedPrice: 20,
        currentListPrice: 30,
        savingsFromGrandfathering: 10,
        expiresAt: null,
      },
    };

    renderPanel("es");
    expect(screen.getByText("Precio anterior")).toBeInTheDocument();
  });
});

describe("accounts table texts", () => {
  it("names the table and the row checkbox in Spanish on the es interface", () => {
    renderIn("es", <AccountsPage />);

    expect(screen.getByRole("table", { name: "Cuentas de usuario" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar cuenta billing@acme.test" })
    ).toBeInTheDocument();
  });

  it("keeps the English names of the table and the row checkbox on the en interface", () => {
    renderIn("en", <AccountsPage />);

    expect(screen.getByRole("table", { name: "User accounts" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select account billing@acme.test" })
    ).toBeInTheDocument();
  });

  it("marks an account without a plan in Spanish on the es interface", () => {
    renderIn("es", <AccountsPage />);

    expect(screen.getByText("Ninguno")).toBeInTheDocument();
  });

  it("keeps the English mark of an account without a plan on the en interface", () => {
    renderIn("en", <AccountsPage />);

    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it.each(["es", "en"] as const)(
    "prefixes the load error from the catalog on the %s interface",
    (locale) => {
      accounts.error = new Error("Network down");
      renderIn(locale, <AccountsPage />);

      expect(screen.getByText("Error: Network down")).toBeInTheDocument();
    }
  );
});

describe("accounts bulk actions", () => {
  it.each([
    ["es", "Suspender", "Suspendidas: 1, con error: 0"],
    ["en", "Suspend", "1 suspended, 0 failed"],
    ["es", "Activar", "Activadas: 1, con error: 0"],
    ["en", "Activate", "1 activated, 0 failed"],
  ] as const)("on the %s interface, %s reports %s", async (locale, action, description) => {
    answerFetch({ ok: true, body: { data: { successful: 1, failed: 0 } } });

    runBulkAction(locale, action);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: CATALOGS[locale].common.success, description })
    );
  });

  it.each([
    ["es", "Suspender", "Falló la suspensión masiva"],
    ["en", "Suspend", "Bulk suspend failed"],
    ["es", "Activar", "Falló la activación masiva"],
    ["en", "Activate", "Bulk activate failed"],
  ] as const)(
    "on the %s interface, a rejected %s reports %s",
    async (locale, action, description) => {
      answerFetch({ ok: false });

      runBulkAction(locale, action);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: CATALOGS[locale].common.error,
          description,
          variant: "destructive",
        })
      );
    }
  );

  it.each([
    ["es", "No se pudieron exportar las cuentas", "Exportar"],
    ["en", "Failed to export accounts", "Export"],
  ] as const)(
    "on the %s interface, an export that fails without an error reports %s",
    async (locale, message, action) => {
      exportAccountsToCSV.mockRejectedValueOnce("network");
      const alert = vi.fn();
      vi.stubGlobal("alert", alert);

      runBulkAction(locale, action);

      await waitFor(() => expect(alert).toHaveBeenCalledWith(message));
    }
  );
});

describe("accounts edit and create messages", () => {
  it.each([
    ["es", "Cuenta actualizada"],
    ["en", "Account updated"],
  ] as const)("on the %s interface, a saved edit reports %s", async (locale, description) => {
    answerFetch({ ok: true });

    saveEdit(locale);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: CATALOGS[locale].common.success, description })
    );
  });

  it("reports an error, not a success, when the settings save is rejected", async () => {
    answerFetch({ ok: false, status: 500 });

    saveEdit("en");

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error", variant: "destructive" })
      )
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: "Account updated" })
    );
  });

  it.each([
    ["es", "Cuenta creada"],
    ["en", "Account created"],
  ] as const)("on the %s interface, a created account reports %s", async (locale, description) => {
    answerFetch({ ok: true });

    createAccount(locale);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: CATALOGS[locale].common.success, description })
    );
  });

  it.each([
    ["es", "No se pudo crear la cuenta"],
    ["en", "Failed to create account"],
  ] as const)(
    "on the %s interface, a rejected creation reports %s",
    async (locale, description) => {
      answerFetch({ ok: false });

      createAccount(locale);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: CATALOGS[locale].common.error,
          description,
          variant: "destructive",
        })
      );
    }
  );
});

describe("AccountBillingPanel texts", () => {
  it("compares the bundle and custom prices and marks the missing session address in Spanish on the es interface", () => {
    renderPanel("es");

    expect(
      screen.getByText("(paquete: $25.00 frente a personalizado: $30.00)")
    ).toBeInTheDocument();
    expect(screen.getByText("N/D")).toBeInTheDocument();
  });

  it("keeps the English bundle comparison and missing session address on the en interface", () => {
    renderPanel("en");

    expect(screen.getByText("(bundle: $25.00 vs custom: $30.00)")).toBeInTheDocument();
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
});
